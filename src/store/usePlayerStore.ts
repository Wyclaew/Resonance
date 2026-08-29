import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register } from "@tauri-apps/plugin-global-shortcut";
import type {
  PlaybackStatus,
  QueueItem,
  RepeatMode,
  ShuffleMode,
  Track,
} from "../types";
import { isTauri } from "../lib/db";
import {
  getRecommendations,
  recordRecommended,
  songCore,
  type Recommendation,
} from "../lib/recommender";
import { recordPlay } from "../lib/history";
import { relinkTrack } from "../lib/playlists";
import { noteListen } from "../lib/mood";
import { publishNowPlaying } from "../lib/nowPlaying";
import { publishDeviceQueue } from "../lib/deviceQueue";
import { gainForTrack } from "../lib/loudness";
import { setArtistPref, PREF_MORE } from "../lib/prefs";
import { useSettingsStore } from "./useSettingsStore";
import { useToastStore } from "./useToastStore";
import { useAppStore } from "./useAppStore";
import { t } from "../lib/i18n";

// Oynatıcı durumu — Rust ses motoruna (rodio) Tauri komutlarıyla bağlı.
// Pozisyon/durum, ses thread'inden gelen "playback-tick" olayıyla güncellenir.

type KarmaTrack = Track & { karma?: number };

interface PlayerState {
  status: PlaybackStatus;
  current: QueueItem | null;
  queue: QueueItem[];
  queueIndex: number;

  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  /** Çalan parçanın ses eşitleme kazancı (lib/loudness.ts). 1 = düzeltme yok. */
  trackGain: number;
  shuffleMode: ShuffleMode;
  repeat: RepeatMode;

  // Resonance Radyosu
  radioActive: boolean;
  radioPlaylistId: string | null;
  skippedRecIds: Set<string>;
  discovering: boolean; // keşif hazırlanıyor (Sidebar butonu spinner gösterir)
  // Şu anki keşif partisini getiren seed sanatçılar — "reroll"da dışlanır.
  discoverySeedArtists: string[];
  /** Keşfet filtreleri (lib/filters.ts id'leri). Boş = saf öğrenme algoritması. */
  discoveryFilters: string[];
  /** ⭐ TARZ KİLİDİ: bu tohum sanatçı sabitlenirse yeni partiler ağırlıklı
   *  ondan beslenir ("bu tarzda devam et"). null = kilit yok. */
  lockedSeedArtist: string | null;

  // Uyku zamanlayıcı
  sleepTimerEndsAt: number | null;
  setSleepTimer: (minutes: number | null) => void;
  /** Çalan şarkı bitince dur (süreye değil parçaya bağlı uyku). */
  sleepAfterTrack: boolean;
  setSleepAfterTrack: (on: boolean) => void;

  error: string | null;

  playNow: (
    track: Track,
    queue?: Track[],
    playlistId?: string,
    /** Bu milisaniyeden başlat (cihazlar arası "kaldığın yerden devam"). */
    startMs?: number
  ) => void;
  /** Saf rastgele çalma (öneri serpiştirmesi YOK) — listedeki şarkılar karışır. */
  playShuffled: (tracks: Track[], playlistId?: string) => void;
  startSmartShuffle: (tracks: KarmaTrack[], playlistId: string) => Promise<void>;
  startDiscovery: (opts?: { force?: boolean }) => Promise<void>;
  rerollDiscovery: () => Promise<void>;
  /** "Bunu daha çok böyle": çalanı bozmadan SIRADAKİLERİ bu tarza çevirir. */
  moreLikeThis: (item: QueueItem) => Promise<void>;
  setDiscoveryFilters: (ids: string[]) => void;
  setLockedSeedArtist: (artist: string | null) => void;
  restoreState: (track: Track, positionMs: number) => void;
  /** Tam kuyruğu duraklatılmış olarak geri yükler (cihazlar arası devam). */
  restoreQueue: (queue: QueueItem[], index: number, positionMs: number) => void;
  restoreDiscovery: (state: DiscoveryResume) => void;
  toggle: () => void;
  next: (reason?: ExitReason) => void;
  prev: () => void;
  jumpTo: (index: number) => void;
  removeFromQueue: (uid: string) => void;
  moveInQueue: (from: number, to: number) => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleShuffle: () => void;
  cycleRepeat: () => void;
}

// Kapat-aç arası Keşfet kuyruğunu hatırlamak için kaydedilen hafif durum.
interface DiscoveryResume {
  queue: QueueItem[];
  queueIndex: number;
  seedArtists: string[];
  /** Kaydedilen Keşfet filtreleri — besleme aynı türle devam etsin. */
  filters?: string[];
  positionMs: number;
}

const repeatOrder: RepeatMode[] = ["off", "all", "one"];

// Keşif modu: playlist'e bağlı olmayan, tamamen öğrenen algoritmanın önerileriyle
// ilerleyen radyo. Bu özel kimlik radioPlaylistId olarak kullanılır.
export const DISCOVERY_ID = "__discovery__";

function toQueueItem(t: Track, playlistId?: string): QueueItem {
  return { ...t, uid: crypto.randomUUID(), playlistId };
}

// Karma ağırlıklı karıştırma: yüksek karma daha öne, downvote'lu geriye.
function weightedShuffle(tracks: KarmaTrack[]): KarmaTrack[] {
  return tracks
    .map((t) => {
      const w = Math.max(0.12, 1 + (t.karma ?? 0) * 0.6);
      // Exponential sıralama anahtarı → ağırlıklı rastgele sıra.
      const key = -Math.log(Math.random()) / w;
      return { t, key };
    })
    .sort((a, b) => a.key - b.key)
    .map((x) => x.t);
}

// Bir öneriyi kuyruk öğesine çevir (araya serpiştirme + keşif için ortak).
function toRecItem(r: Recommendation, playlistId: string): QueueItem {
  return {
    ...r,
    uid: crypto.randomUUID(),
    playlistId,
    isRecommendation: true,
    recSource: r.recSource,
    recReason: r.reason,
    // Tarz vekili + prob işareti kuyrukta TAŞINMALI: oturum modu parça
    // bittiğinde bunlara bakıyor (bkz. recordOutgoing → noteListen).
    seedArtist: r.seedArtist,
    isProbe: r.isProbe,
  };
}

// Çeşitlilik: bir öneri dizisinde arka arkaya AYNI sanatçı gelmesin. İki komşu
// öğe aynı sanatçıysa, sonraki farklı sanatçılı öğeyle yer değiştirilir.
function spreadByArtist<T extends { artist: string }>(items: T[]): T[] {
  const out = [...items];
  for (let i = 1; i < out.length; i++) {
    if (out[i].artist && out[i].artist === out[i - 1].artist) {
      let j = i + 1;
      while (j < out.length && out[j].artist === out[i - 1].artist) j++;
      if (j < out.length) [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

// Öneri getir ve MEVCUT kuyruğa, queueIndex sonrasında recEveryN aralıkla
// serpiştir. Hem startSmartShuffle (taze karışık kuyruk) hem de akıllı-karışığa
// geçiş (mevcut kuyruk korunur) tarafından paylaşılır.
async function fetchAndInterleave(
  playlistId: string,
  extraExclude: string[] = []
) {
  const s = useSettingsStore.getState();
  if (!s.recEnabled || (!s.recYouTube && !s.recLibrary)) return;
  const st = usePlayerStore.getState();
  const remaining = Math.max(1, st.queue.length - st.queueIndex);
  try {
    const exclude = new Set<string>([
      ...extraExclude,
      ...st.queue.map((i) => i.id),
      ...st.skippedRecIds,
      ...recommendedThisSession,
    ]);
    const recs = await getRecommendations({
      playlistId,
      excludeIds: exclude,
      excludeCores: buildExcludeCores(),
      limit: Math.max(2, Math.ceil(remaining / s.recEveryN) + 1),
      useYouTube: s.recYouTube,
      useLibrary: s.recLibrary,
      halfLifeDays: s.karmaHalfLifeDays,
    });
    if (recs.length === 0) return;
    rememberRecs(recs);
    const spread = spreadByArtist(recs);
    usePlayerStore.setState((state) => {
      if (!state.radioActive || state.radioPlaylistId !== playlistId) return {};
      const q = [...state.queue];
      const recItems = spread.map((r) => toRecItem(r, playlistId));
      // Mevcut konumdan sonra her recEveryN parçada bir öneri ekle.
      let insertAt = state.queueIndex + s.recEveryN + 1;
      let ri = 0;
      while (ri < recItems.length && insertAt <= q.length) {
        q.splice(insertAt, 0, recItems[ri++]);
        insertAt += s.recEveryN + 1;
      }
      while (ri < recItems.length) q.push(recItems[ri++]);
      return { queue: q };
    });
    // Önerileri konumlarından bağımsız hemen prefetch et (sıra gelince hazır olsun).
    if (isTauri() && s.prefetchEnabled) {
      for (const r of recs) {
        invoke("prefetch_audio", {
          sourceId: r.sourceId,
          cookiesBrowser: s.cookiesBrowser,
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error("[resonance] öneriler serpiştirilemedi:", e);
  }
}

// Ses motoruna en az bir kez Load gönderildi mi? (açılışta "kaldığın yerden
// devam" için: current var ama henüz yüklenmemişse, play'e basınca kaldığı
// pozisyondan yükle.)
let hasLoaded = false;
let resumeMsPending = 0;
// Her loadAndPlay çağrısına artan bir token verilir. Yükleme HATASI geldiğinde
// yalnızca EN GÜNCEL yükleme kuyruğu ilerletir; bu arada kullanıcı başka şarkıya
// geçtiyse (token eskidi) hiçbir şey yapılmaz. Aksi halde eski/indirilemeyen bir
// öneri hata verince O AN çalan şarkı yanlışlıkla atlanıyordu ("durup dururken
// şarkı geçti" bug'ı).
let currentLoadToken = 0;

// ⭐ SES SEVİYESİ EŞİTLEME (v1.8.0). Kazanç, kullanıcının ses düzeyiyle
// ÇARPILIR — kullanıcının sesi tek gerçek referans, kazanç yalnız düzeltmedir.
// Ölçüm dosya indikten sonra yapıldığı için gecikmeli gelir; bu yüzden
// uygulanmadan önce "hâlâ aynı parça mı" diye bakılır.
function pushVolume(): void {
  if (!isTauri()) return;
  const { volume, muted, trackGain } = usePlayerStore.getState();
  const v = muted ? 0 : Math.max(0, Math.min(2, volume * trackGain));
  invoke("audio_set_volume", { volume: v }).catch(() => {});
}

async function applyTrackGain(item: QueueItem): Promise<void> {
  if (!useSettingsStore.getState().normalizeVolume) {
    if (usePlayerStore.getState().trackGain !== 1) {
      usePlayerStore.setState({ trackGain: 1 });
      pushVolume();
    }
    return;
  }
  const gain = await gainForTrack(item.id, item.sourceId);
  // Ölçüm sürerken kullanıcı başka şarkıya geçmiş olabilir.
  if (usePlayerStore.getState().current?.uid !== item.uid) return;
  usePlayerStore.setState({ trackGain: gain });
  pushVolume();
}

// ⭐ YÜKLEME BEKÇİSİ. `play_track` Rust tarafında dört katmanlı indirme +
// alternatif kaynak arayabildiği için uzun sürebilir; ama SONSUZA KADAR
// sürmemeli. Süre aşılırsa durumu "paused"a çekiyoruz — yoksa arayüz
// "loading"de kilitleniyor ve `toggle()` orada erken döndüğü için
// OYNAT TUŞU TAMAMEN ÖLÜYORDU (Windows'ta yaşanan tablo).
const LOAD_TIMEOUT_MS = 45_000;
let loadWatchdog: ReturnType<typeof setTimeout> | undefined;
let loadingSince = 0;

function loadAndPlay(item: QueueItem, startMs = 0) {
  if (!isTauri()) return;
  hasLoaded = true;
  const myToken = ++currentLoadToken;
  loadingSince = Date.now();
  clearTimeout(loadWatchdog);
  loadWatchdog = setTimeout(() => {
    const st = usePlayerStore.getState();
    if (myToken !== currentLoadToken || st.status !== "loading") return;
    useToastStore.getState().show(t("player.loadStuck"), "error");
    // ⚠️ `hasLoaded`'ı da geri al: ses motoruna hiçbir şey ULAŞMADI. Aksi
    // hâlde sonraki play basışı `audio_play` çağırıp durumu "çalıyor" yapar
    // ama ortada çalacak bir şey olmadığı için SESSİZ kalırdı (v1.8.5'te
    // düzeltilen tuzağın aynısı).
    hasLoaded = false;
    usePlayerStore.setState({ status: "paused" });
  }, LOAD_TIMEOUT_MS);
  // Yeni parçada eski kazancı hemen bırak: ölçüm gelene kadar kullanıcının
  // kendi seviyesi geçerli olsun (aksi hâlde önceki şarkının düzeltmesi
  // yenisine uygulanır ve ses fırlar).
  if (usePlayerStore.getState().trackGain !== 1) {
    usePlayerStore.setState({ trackGain: 1 });
    pushVolume();
  }
  // Crossfade YALNIZ normal geçişte anlamlı: kullanıcı elle şarkı seçtiyse
  // (ya da kaldığı yerden devam ediyorsa) anında geçiş beklenir.
  const fadeMs = startMs === 0 && crossfadeArmed ? crossfadeMs() : 0;
  crossfadeArmed = false;
  invoke("play_track", {
    input: {
      sourceId: item.sourceId,
      durationMs: item.durationMs,
      trackId: item.id,
      resumeMs: Math.floor(startMs),
      fadeMs,
      // Yerel dosya: indirme/akış yolları atlanır (bkz. lib/localFiles.ts).
      localPath: item.source === "local" ? item.sourceId : null,
      // Alternatif kaynak araması için: bu video inmezse aynı şarkının başka
      // yüklemesi bulunup çalınır (Rust: find_alternative).
      title: item.title,
      artist: item.artist,
    },
    cookiesBrowser: useSettingsStore.getState().cookiesBrowser,
  })
    .then(() => {
      // play_track döndüyse dosya cache'te hazır demektir → ölçülebilir.
      if (myToken !== currentLoadToken) return;
      clearTimeout(loadWatchdog);
      void applyTrackGain(item);
    })
    .catch((e) => {
      // Bu yükleme hâlâ güncel mi? Değilse (kullanıcı başka şarkıya geçti) DOKUNMA.
      if (myToken !== currentLoadToken) return;
      // İndirilemeyen şarkı (silinmiş/geçici hata) kuyruğu TIKAMASIN: sıradaki
      // varsa atla. Art arda çok hata olursa dur ki sonsuz döngü olmasın.
      console.error("[resonance] play_track hatası:", e);
      clearTimeout(loadWatchdog);
      const st = usePlayerStore.getState();
      loadFailCount++;
      if (
        loadFailCount <= 5 &&
        st.queue.length > 1 &&
        st.queueIndex < st.queue.length - 1
      ) {
        useToastStore.getState().show(t("player.loadFailed"), "error");
        st.next();
      } else {
        useToastStore
          .getState()
          .show(`Şarkı yüklenemedi — ${String(e)}`, "error");
        // Motorda yüklü bir şey yok → sonraki play yeniden YÜKLEMELİ.
        hasLoaded = false;
        usePlayerStore.setState({ status: "idle", error: String(e) });
      }
    });
}
// Art arda yükleme (indirme) hatası sayacı — başarılı çalmada sıfırlanır.
let loadFailCount = 0;

// Yüklemeyi kısa süre geciktir (debounce). Kullanıcı hızlıca şarkı geçerken
// HER basış ayrı bir indirme+play_track tetikleyip uygulamayı şişiriyordu; ayrıca
// indirmeler yarışıp ses motoru başka, arayüz başka şarkı gösteriyordu. Bu
// sarmalayıcı yalnızca EN SON seçilen şarkıyı (basış durduktan ~180ms sonra)
// yükler → tek indirme, arayüz-ses her zaman aynı.
let loadTimer: ReturnType<typeof setTimeout> | undefined;
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleLoad(item: QueueItem, startMs = 0, immediate = false) {
  // Yeni yükleme = eski hata geçersiz. `error` yalnız playNow türü girişlerde
  // temizleniyordu; atlama/geri/jump yollarında SON hata takılı kalıyor ve
  // mini oynatıcı çalan şarkının altında eski hatayı göstermeye devam ediyordu.
  if (usePlayerStore.getState().error) usePlayerStore.setState({ error: null });
  clearTimeout(loadTimer);
  // ⭐ 180 ms'lik debounce KULLANICI hızlı hızlı şarkı geçerken gereklidir;
  // ama şarkı KENDİ bitince beklemenin anlamı yok — o gecikme doğrudan
  // parçalar arası sessizliğe dönüşüyordu. Bitişte anında yükle.
  loadTimer = setTimeout(() => loadAndPlay(item, startMs), immediate ? 0 : 180);
  // Prefetch'i daha uzun beklet: kullanıcı hızlıca şarkı geçerken geçilen
  // şarkılar boşuna indirilmesin — yalnızca durduktan sonra sıradakiler hazırlanır.
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => prefetchNext(), 1500);
}

let sleepTimeout: ReturnType<typeof setTimeout> | undefined;
// ⚠️ Fade'in BAŞLAMA zamanlayıcısı da tutulmalı: tutulmazsa iptal edilen bir
// zamanlayıcının fade'i, sonradan kurulan YENİ zamanlayıcının ortasında
// tetikleniyordu (sesi kendiliğinden kısılan, dakikalarca geri gelmeyen müzik).
let sleepFadeStart: ReturnType<typeof setTimeout> | undefined;
let sleepFade: ReturnType<typeof setInterval> | undefined;
let sleepBaseVolume = 0;
/** Fade sırasında kısılan sesi kullanıcının seviyesine geri getirir. */
function restoreVolumeAfterSleep(): void {
  if (sleepBaseVolume > 0) {
    usePlayerStore.setState({ volume: sleepBaseVolume });
    if (isTauri()) {
      invoke("audio_set_volume", { volume: sleepBaseVolume }).catch(() => {});
    }
    sleepBaseVolume = 0;
  }
}

// Ses düzeyini ayarlara debounce'lu kaydet (sürükleme sırasında DB'yi yormamak için).
let volSaveTimer: ReturnType<typeof setTimeout> | undefined;
function persistVolume(v: number) {
  const s = useSettingsStore.getState();
  if (!s.rememberVolume) return;
  clearTimeout(volSaveTimer);
  volSaveTimer = setTimeout(() => s.update("savedVolume", v), 600);
}

// Son çalan şarkı + pozisyonu ayarlara kaydet (kaldığın yerden devam). Tick her
// 250ms geldiği için throttle'lanır (~5sn'de bir yazılır).
let lastStateSave = 0;
// Çalan durumu settings'e yazar (kaldığın yerden devam).
// ⭐ KEŞFET AKTİFSE tüm kuyruğu kaydeder → kapat-aç son Keşfet partisini aynen
// getirir, reroll atmadıkça değişmez (kullanıcı isteği). Değilse tek şarkı
// (mode yok = geriye dönük uyumlu "single").
function liteItem(i: QueueItem): QueueItem {
  return {
    ...i,
    // uid restore'da yeniden üretilir; yine de saklamak zararsız.
  };
}
function persistPlaybackState(force = false) {
  const st = usePlayerStore.getState();
  const c = st.current;
  if (!c) return;
  const now = Date.now();
  if (!force && now - lastStateSave < 5000) return;
  lastStateSave = now;

  // Cihazlar arası devam: bu cihazın durumunu senkronlanan tabloya yaz
  // (kendi içinde 15 sn throttle'lı).
  void publishNowPlaying(c, st.positionMs, st.status === "playing");

  const isDiscovery =
    st.radioActive && st.radioPlaylistId === DISCOVERY_ID && st.queue.length > 0;
  const payload = isDiscovery
    ? JSON.stringify({
        mode: "discovery",
        queue: st.queue.map(liteItem),
        queueIndex: st.queueIndex,
        seedArtists: st.discoverySeedArtists,
        filters: st.discoveryFilters,
        positionMs: st.positionMs,
      })
    : JSON.stringify({
        track: {
          id: c.id,
          source: c.source,
          sourceId: c.sourceId,
          title: c.title,
          artist: c.artist,
          album: c.album,
          thumbnail: c.thumbnail,
          durationMs: c.durationMs,
        },
        positionMs: st.positionMs,
      });
  useSettingsStore.getState().update("resumeState", payload);

  // ⭐ Aynı durumu BULUTA da yaz (lib/deviceQueue.ts). resumeState cihaza özel
  // kalır (settings senkronlanmıyor); cihazlar arası devam bu tablodan gelir.
  void publishDeviceQueue(
    isDiscovery ? "discovery" : "normal",
    st.queue,
    st.queueIndex,
    st.positionMs,
    isDiscovery ? null : st.radioPlaylistId ?? c.playlistId ?? null,
    st.discoveryFilters,
    st.discoverySeedArtists,
    force
  );
}

// Sıradaki parçaları arka planda indir/hazırla → hızlı arka arkaya geçişler de
// anlık olur. 3 önden hazırlanır (zaten cache'tekiler yt-dlp bile çağırmaz).
/**
 * ⭐ ADRES ISITMA — sıradaki şarkıların indirme adreslerini ÖNDEN çöz.
 *
 * ÖLÇÜM (2026-08-19): bir şarkının hazır olması ~3.3 sn ve bunun 2.45 sn'si
 * ADRES ÇÖZÜMÜ; indirmenin kendisi 0.8 sn. Yani hızlanmanın asıl kaldıracı
 * paralel indirme değil, adresi önceden çözmüş olmak. Dosya indirmek pahalı
 * olduğu için yalnız 2 şarkı prefetch edilir; adres çözümü ucuz ve toplu
 * yapılabildiği için 8 şarkı ısıtılır.
 *
 * ⚠️ prefetchNext'e bağlı BIRAKILAMAZ: o yalnız şarkı yüklenirken çalışır.
 * Uygulama duraklatılmış açıldığında kuyruk hazırdır ama hiç ısıtılmazdı →
 * kullanıcı play'e bastığında yine 2.5 sn beklerdi.
 */
export function prewarmQueueUrls(): void {
  if (!isTauri()) return;
  if (!useSettingsStore.getState().prefetchEnabled) return;
  const { queue, queueIndex } = usePlayerStore.getState();
  const ids = queue
    .slice(Math.max(0, queueIndex), queueIndex + 9)
    .map((i) => i.sourceId)
    .filter(Boolean);
  if (ids.length === 0) return;
  invoke("prewarm_urls", {
    sourceIds: ids,
    cookiesBrowser: useSettingsStore.getState().cookiesBrowser,
  }).catch(() => {});
}

// Crossfade süresi (ms). 0 = kapalı. Ayarlar → Çalma.
function crossfadeMs(): number {
  return Math.round(useSettingsStore.getState().crossfadeSeconds * 1000);
}
// Aynı parça için crossfade'in bir kez tetiklenmesini sağlar; her yeni
// yüklemede sıfırlanır (aksi hâlde tick akışında defalarca next() çağrılırdı).
let crossfadeArmed = false;

// Ağa göre önerilen tampon (native_dl::health). 60 sn'de bir tazelenir.
let dynamicBuffer = 5;
let bufferCheckedAt = 0;
function refreshBufferSize(): void {
  if (!isTauri()) return;
  const now = Date.now();
  if (now - bufferCheckedAt < 60_000) return;
  bufferCheckedAt = now;
  invoke<{ mbps: number; failRate: number; buffer: number }>("download_health")
    .then((h) => {
      if (h.buffer >= 1 && h.buffer <= 12) dynamicBuffer = h.buffer;
    })
    .catch(() => {});
}

/** Kuyruk değişti ama çalan şarkı aynı → yalnız hazırlığı tazele. */
function scheduleLoadPrefetchOnly(): void {
  prewarmQueueUrls();
  setTimeout(() => prefetchNext(), 300);
}

function prefetchNext() {
  if (!isTauri()) return;
  // Ekran koruyucu aktifken ağır yt-dlp çağrılarını durdur (CPU/disk tasarrufu).
  if (useAppStore.getState().idle) return;
  if (!useSettingsStore.getState().prefetchEnabled) return;
  const { queue, queueIndex } = usePlayerStore.getState();
  const cookiesBrowser = useSettingsStore.getState().cookiesBrowser;
  prewarmQueueUrls();

  // ⭐ AKILLI TAMPON (v1.8.2): sabit sayı yerine AĞA GÖRE.
  // Rust tarafı son 20 indirmenin hızını ve başarı oranını ölçüyor
  // (native_dl::health): bağlantı yavaş/kopuyorsa tampon 8'e çıkar (müzik
  // durmasın), hızlı ve sorunsuzsa 3'e iner (boşuna veri/disk harcanmasın).
  // Sağlık sorgusu ucuz ama her şarkıda gerekmiyor → 60 sn'de bir tazelenir.
  refreshBufferSize();
  const bufferSize = dynamicBuffer;

  // ⭐ ÇEVRİMDIŞI TAMPON (v1.8.1): 2 → 5 şarkı.
  // Neden artık güvenli: adresler önden çözülüyor (prewarm) ve indirmeyi
  // kendi indiricimiz yapıyor → şarkı başına yt-dlp süreci başlatılmıyor.
  // Eskiden 3 paralel hazırlık YouTube hız sınırını tetikliyordu; darboğaz
  // ortadan kalkınca tamponu büyütmek ağ koptuğunda/YouTube tıkandığında
  // müziğin devam etmesini sağlıyor. İstekler Rust tarafında sıraya giriyor
  // (dl_semaphore), yani 5 istek aynı anda ağa çıkmıyor.
  for (let i = 1; i <= bufferSize; i++) {
    const item = queue[queueIndex + i];
    if (!item) break;
    invoke("prefetch_audio", {
      sourceId: item.sourceId,
      cookiesBrowser,
    }).catch(() => {});
  }
}

// Parçadan nasıl çıkıldı? Sinyalin ANLAMI buna bağlı.
type ExitReason = "ended" | "next" | "prev" | "jump";

// ⭐ YANLIŞ TUŞ / GEZİNME GÜRÜLTÜSÜ FİLTRESİ
//
// Problem: kullanıcı sevmediği şarkıyı geçmek için "sonraki"ye basacakken
// yanlışlıkla "önceki"ye basıyor. Eski kod bunu ölçüsüzce sinyale çeviriyordu:
//  • geçilen şarkı 1-2 sn çalmış görünüyordu → recommender'da <5sn = −0.35 ceza,
//  • geri dönülen (SEVDİĞİ) şarkı da 1-2 sn çalıp yine −0.35 yiyordu,
//  • üstüne öneriyse `skippedRecIds`'e giriyordu.
// Yani tek yanlış tuş İKİ şarkıya birden haksız ceza yazıyordu.
//
// Kural: "önceki" ve "sıradan atla" bir YARGIY DEĞİL, GEZİNMEDİR. Kısa süreli
// gezinme çıkışları hiç kaydedilmez (ne olumlu ne olumsuz). Uzun dinlemeden
// sonra geri basmak gerçek bir dinlemedir → normal kaydedilir.
// Çalma HATASI (indirilemedi / bozuk dosya) sonrası atlamada mod sinyali
// yazılmaz: kullanıcı o şarkıyı hiç duymadı. Bayrak tek seferliktir.
let skipMoodOnce = false;
export function suppressMoodSignal() {
  skipMoodOnce = true;
}

const NAV_NOISE_MS = 10_000; // bu sürenin altında gezinme = gürültü
const CORRECTION_MS = 8_000; // "önceki"den sonra bu süre içindeki "sonraki" = düzeltme
let lastPrevAt = 0;

function recordOutgoing(s: PlayerState, reason: ExitReason) {
  if (!s.current) return;
  const short = s.positionMs < NAV_NOISE_MS;
  // Yanlışlıkla geri basıp hemen ileri basarak düzeltme: o "sonraki" de
  // gezinmedir, kullanıcının o şarkıyı beğenmediği anlamına GELMEZ.
  const correcting =
    reason === "next" && Date.now() - lastPrevAt < CORRECTION_MS;
  const navigating = reason === "prev" || reason === "jump" || correcting;

  if (navigating && short) return; // sinyal yazma — yanlış tuş sayılır

  recordPlay(s.current, s.positionMs);

  // ⭐ OTURUM MODU: bu tarzı ne kadar dinledin? (lib/mood.ts)
  // Gezinme gürültüsü yukarıda elendiği için buraya yalnız gerçek dinlemeler
  // ve gerçek atlamalar düşer — mod profili yanlış tuştan bozulmaz.
  if (skipMoodOnce) {
    skipMoodOnce = false; // hata kaynaklı atlama — tarzı cezalandırma
  } else if (s.current.isRecommendation && s.durationMs > 0) {
    noteListen(s.current.seedArtist, s.positionMs / s.durationMs);
  }

  // Ceza YALNIZ gerçek atlamada (kullanıcı bilerek "sonraki" dedi).
  if (
    !navigating &&
    reason === "next" &&
    s.current.isRecommendation &&
    s.positionMs < Math.min(20_000, s.durationMs * 0.3)
  ) {
    const skipped = new Set(s.skippedRecIds);
    skipped.add(s.current.id);
    usePlayerStore.setState({ skippedRecIds: skipped });
  }
}

// Bu oturumda önerilen tüm parça id'leri — aynı şarkının tekrar tekrar
// önerilmesini engeller (kullanıcı "sürekli aynı şeyler geliyor" demişti).
const recommendedThisSession = new Set<string>();
// Aynı şarkının FARKLI kaydı/versiyonu (başka sanatçıdan, slowed+reverb vb.)
// farklı ID taşır → ID dışlaması yetmez. Önerilen şarkıların "adı çekirdeği"
// burada tutulur ve her öneri isteğine geçirilir (partiler arası tekrar engeli).
const recommendedCoresThisSession = new Set<string>();

// Öneri isteklerine geçilecek çekirdek dışlama kümesi: bu oturumda önerilenler
// + hâlihazırda kuyrukta olanlar.
function buildExcludeCores(): Set<string> {
  const cores = new Set<string>(recommendedCoresThisSession);
  for (const it of usePlayerStore.getState().queue) {
    cores.add(songCore(it.title, it.artist));
  }
  return cores;
}

// Kabul edilen önerileri oturum hafızasına (id + çekirdek) işle.
// Bir öneri partisini hangi sanatçıların radyoları getirdi (benzersiz).
function seedArtistsOf(recs: Recommendation[]): string[] {
  return [...new Set(recs.map((r) => r.seedArtist).filter(Boolean) as string[])];
}

function rememberRecs(recs: Recommendation[]) {
  for (const r of recs) {
    recommendedThisSession.add(r.id);
    recommendedCoresThisSession.add(songCore(r.title, r.artist));
  }
}

// --- Keşif prewarm: açılışta (ve her keşif başlangıcından sonra) arka planda bir
// öneri partisi hazırlanır ve ilk şarkı indirilir; böylece Keşfet'e basınca
// ANINDA başlar. Kayıt YAPILMAZ (record:false) — kullanılmadan "harcanmasın";
// kullanılınca recordRecommended ile kaydedilir. ---
let discoveryPrewarm: Recommendation[] | null = null;
let prewarming = false;
export async function prewarmDiscovery() {
  if (prewarming || discoveryPrewarm || !isTauri()) return;
  const s = useSettingsStore.getState();
  if (!s.recEnabled || (!s.recYouTube && !s.recLibrary)) return;
  prewarming = true;
  try {
    const recs = await getRecommendations({
      playlistId: DISCOVERY_ID,
      filters: usePlayerStore.getState().discoveryFilters,
      lockedSeedArtist:
        usePlayerStore.getState().lockedSeedArtist ?? undefined,
      excludeIds: new Set(recommendedThisSession),
      excludeCores: buildExcludeCores(),
      limit: 20,
      useYouTube: s.recYouTube,
      useLibrary: s.recLibrary,
      halfLifeDays: s.karmaHalfLifeDays,
      record: false, // kullanılana kadar geçmişe yazma
    });
    if (recs.length > 0) {
      discoveryPrewarm = recs;
      // İlk şarkıyı indirmeye başla → buton anında tepki versin.
      if (s.prefetchEnabled) {
        invoke("prefetch_audio", {
          sourceId: recs[0].sourceId,
          cookiesBrowser: s.cookiesBrowser,
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error("[resonance] keşif prewarm başarısız:", e);
  } finally {
    prewarming = false;
  }
}

// Radyo/keşifte sırada hep bu kadar (yaklaşık) şarkı yüklü tutulur; altına
// inince hemen tamamlanır.
const TARGET_QUEUE_AHEAD = 20;

// Radyo uzun oturumda tükenmesin: kuyruk sonuna yaklaşınca arka planda yeni
// öneri çekip ekler (sonsuz radyo). Ekran koruyucu aktifken çalışmaz.
let refilling = false;
// playAfter: kuyruk BİTTİĞİ için çağrıldıysa, besledikten sonra ilk yeni
// öneriye otomatik geç (radyo durmasın).
async function refillRadio(playAfter = false) {
  if (refilling || !isTauri()) return;
  if (useAppStore.getState().idle) return;
  const st = usePlayerStore.getState();
  if (!st.radioActive || !st.radioPlaylistId) return;
  const s = useSettingsStore.getState();
  if (!s.recEnabled || (!s.recYouTube && !s.recLibrary)) return;
  const playlistId = st.radioPlaylistId;
  refilling = true;
  try {
    // Sıradaki (upcoming) şarkı sayısı hep TARGET_QUEUE_AHEAD (~20) tutulsun:
    // eksiği kadar öneri çek.
    const upcoming = st.queue.length - st.queueIndex - 1;
    const needed = Math.max(TARGET_QUEUE_AHEAD - upcoming, 6);
    const exclude = new Set<string>([
      ...st.queue.map((i) => i.id),
      ...st.skippedRecIds,
      ...recommendedThisSession,
    ]);
    const recs = await getRecommendations({
      playlistId,
      // Keşfet'te besleme de AYNI filtreyle devam etmeli; yoksa kuyruk
      // ilerledikçe seçtiğin tür sessizce kaybolurdu.
      filters:
        playlistId === DISCOVERY_ID ? st.discoveryFilters : undefined,
      lockedSeedArtist:
        playlistId === DISCOVERY_ID
          ? st.lockedSeedArtist ?? undefined
          : undefined,
      excludeIds: exclude,
      excludeCores: buildExcludeCores(),
      limit: needed,
      useYouTube: s.recYouTube,
      useLibrary: s.recLibrary,
      halfLifeDays: s.karmaHalfLifeDays,
    });
    if (recs.length === 0) {
      // Öneri bulunamadıysa ve kuyruk bittiyse dur; kullanıcıya bildir.
      if (playAfter) {
        usePlayerStore.setState({ status: "idle" });
        useToastStore
          .getState()
          .show(t("rec.exhausted"), "info");
      }
      return;
    }
    rememberRecs(recs);
    const spread = spreadByArtist(recs);
    usePlayerStore.setState((state) => {
      if (!state.radioActive || state.radioPlaylistId !== playlistId) return {};
      const recItems: QueueItem[] = spread.map((r) => toRecItem(r, playlistId));
      return { queue: [...state.queue, ...recItems] };
    });
    // Eklenen TÜM önerileri önden indir (sıradaki 20 hep hazır olsun).
    for (const r of recs) {
      invoke("prefetch_audio", {
        sourceId: r.sourceId,
        cookiesBrowser: s.cookiesBrowser,
      }).catch(() => {});
    }
    // Kuyruk bitmişti → yeni eklenen ilk öneriye geç.
    if (playAfter) {
      const cur = usePlayerStore.getState();
      const nextIdx = cur.queueIndex + 1;
      if (cur.radioActive && nextIdx < cur.queue.length) {
        const item = cur.queue[nextIdx];
        usePlayerStore.setState({
          queueIndex: nextIdx,
          current: item,
          status: "loading",
          positionMs: 0,
          durationMs: item.durationMs,
        });
        scheduleLoad(item);
      }
    }
  } catch (e) {
    console.error("[resonance] radyo beslenemedi:", e);
    if (playAfter) usePlayerStore.setState({ status: "idle" });
  } finally {
    refilling = false;
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  status: "idle",
  current: null,
  queue: [],
  queueIndex: -1,

  positionMs: 0,
  durationMs: 0,
  volume: 0.9,
  trackGain: 1,
  muted: false,
  shuffleMode: "off",
  repeat: "off",

  radioActive: false,
  radioPlaylistId: null,
  skippedRecIds: new Set(),
  discoverySeedArtists: [],
  discoveryFilters: [],
  lockedSeedArtist: null,
  discovering: false,

  sleepTimerEndsAt: null,
  setSleepTimer: (minutes) => {
    clearTimeout(sleepTimeout);
    clearTimeout(sleepFadeStart);
    clearInterval(sleepFade);
    set({ sleepAfterTrack: false });
    if (minutes == null) {
      restoreVolumeAfterSleep();
      set({ sleepTimerEndsAt: null });
      return;
    }
    const ms = minutes * 60000;
    set({ sleepTimerEndsAt: Date.now() + ms });

    // ⭐ FADE-OUT (v1.8.3): süre dolarken ses kademeli kısılır. Müziğin
    // ortasında aniden kesilmesi uykuya dalanı UYANDIRIYOR — asıl istenen
    // yumuşak sönme. Kullanıcının ses seviyesi saklanır ve zamanlayıcı
    // iptal edilirse/bittikten sonra geri yüklenir.
    const fadeSec = useSettingsStore.getState().sleepFadeSeconds;
    if (fadeSec > 0 && ms > fadeSec * 1000) {
      const fadeStart = ms - fadeSec * 1000;
      sleepFadeStart = setTimeout(() => {
        const st = get();
        if (!st.sleepTimerEndsAt) return; // iptal edilmiş
        sleepBaseVolume = st.volume;
        const t0 = Date.now();
        sleepFade = setInterval(() => {
          const p = Math.min(1, (Date.now() - t0) / (fadeSec * 1000));
          const v = sleepBaseVolume * (1 - p);
          if (isTauri()) invoke("audio_set_volume", { volume: v }).catch(() => {});
          if (p >= 1) clearInterval(sleepFade);
        }, 500);
      }, fadeStart);
    }

    sleepTimeout = setTimeout(() => {
      if (isTauri()) invoke("audio_pause").catch(() => {});
      clearTimeout(sleepFadeStart);
      clearInterval(sleepFade);
      set({ status: "paused", sleepTimerEndsAt: null });
      restoreVolumeAfterSleep();
    }, ms);
  },

  // ⭐ "ŞARKI BİTİNCE DUR": süre yerine parça sonuna bağlı uyku.
  // Dinlediğin şarkı yarıda kesilmesin diye en çok istenen varyant.
  sleepAfterTrack: false,
  setSleepAfterTrack: (on) => {
    clearTimeout(sleepTimeout);
    clearTimeout(sleepFadeStart);
    clearInterval(sleepFade);
    restoreVolumeAfterSleep();
    set({ sleepAfterTrack: on, sleepTimerEndsAt: null });
  },

  error: null,

  playNow: (track, queue, playlistId, startMs = 0) => {
    const items = (queue ?? [track]).map((t) => toQueueItem(t, playlistId));
    const idx = Math.max(0, items.findIndex((i) => i.id === track.id));
    const current = items[idx];
    // ⭐ BUG (v1.8.0'da düzeltildi): playNow shuffleMode'u TAMAMEN yok sayıyor,
    // radioActive'i de false yapıyordu. Sonuç: kullanıcı alt barda "akıllı
    // karışık" görüyor ama şarkılar sırayla çalıyordu (öneri de gelmiyordu),
    // çünkü next() akıllı modda beslemeyi radioActive'e bağlar.
    // Artık mod korunur: "smart" seçiliyken listeden çalmak beslemeyi açar.
    const smart = get().shuffleMode === "smart" && !!playlistId;
    set({
      queue: items,
      queueIndex: idx,
      current,
      status: "loading",
      positionMs: startMs,
      durationMs: track.durationMs,
      radioActive: smart,
      radioPlaylistId: smart ? playlistId ?? null : null,
      error: null,
    });
    scheduleLoad(current, startMs);
    if (smart) void refillRadio();
  },

  // Saf rastgele: listedeki şarkılar karıştırılır, ÖNERİ SERPİŞTİRİLMEZ.
  // ("Önerili rastgele" ayrı bir seçenek — startSmartShuffle.)
  playShuffled: (tracks, playlistId) => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const items = shuffled.map((t) => toQueueItem(t, playlistId));
    set({
      queue: items,
      queueIndex: 0,
      current: items[0],
      status: "loading",
      positionMs: 0,
      durationMs: items[0].durationMs,
      shuffleMode: "shuffle",
      radioActive: false,
      radioPlaylistId: null,
      error: null,
    });
    scheduleLoad(items[0]);
  },

  // Akıllı karışık: karma-ağırlıklı karıştırılmış kuyruk + araya Resonance
  // önerileri serpiştirilir (Spotify "smart shuffle" benzeri). shuffleMode="smart"
  // olur ve radyo döngüsü (sonsuz besleme) aktifleşir.
  startSmartShuffle: async (tracks, playlistId) => {
    if (tracks.length === 0) return;
    const baseItems = weightedShuffle(tracks).map((t) =>
      toQueueItem(t, playlistId)
    );
    const first = baseItems[0];
    set({
      queue: baseItems,
      queueIndex: 0,
      current: first,
      status: "loading",
      positionMs: 0,
      durationMs: first.durationMs,
      radioActive: true,
      radioPlaylistId: playlistId,
      shuffleMode: "smart",
      error: null,
    });
    scheduleLoad(first);
    // Önerileri arka planda getir ve kuyruğa serpiştir (oynatmayı bekletmeden).
    await fetchAndInterleave(playlistId, tracks.map((t) => t.id));
  },

  // Keşif modu: playlist yok — tamamen öğrenen algoritmanın önerileriyle ilerler.
  // Sürekli beslenir (refillRadio radioPlaylistId=DISCOVERY_ID ile çalışır).
  startDiscovery: async (opts) => {
    // Keşif ZATEN çalışıyorsa yeni sıra kurma — mevcut sırayı koru.
    // force:true (Keşfet sayfasındaki "Yeni keşif" / filtre değişimi) bunu deler.
    const cur = get();
    if (
      !opts?.force &&
      cur.radioActive &&
      cur.radioPlaylistId === DISCOVERY_ID &&
      cur.queue.length > 0
    ) {
      return;
    }
    if (get().discovering) return; // arka arkaya basışları yut

    const s = useSettingsStore.getState();
    if (!s.recEnabled || (!s.recYouTube && !s.recLibrary)) {
      useToastStore
        .getState()
        .show(t("common.recsOff"), "info");
      return;
    }
    set({ discovering: true, status: "loading" });
    try {
      // Prewarm hazırsa anında kullan; değilse taze çek.
      let recs = discoveryPrewarm;
      discoveryPrewarm = null;
      if (!recs) {
        recs = await getRecommendations({
          playlistId: DISCOVERY_ID,
          filters: get().discoveryFilters,
          lockedSeedArtist: get().lockedSeedArtist ?? undefined,
          // Bir önceki partinin seed sanatçılarını dışla → ardışık partiler
          // aynı sanatçı kümesinden beslenmesin ("hep aynı sanatçılar").
          excludeSeedArtists: new Set(
            get().discoverySeedArtists.map((a) => a.toLowerCase())
          ),
          excludeIds: new Set<string>([
            ...get().skippedRecIds,
            ...recommendedThisSession,
          ]),
          excludeCores: buildExcludeCores(),
          limit: 20,
          useYouTube: s.recYouTube,
          useLibrary: s.recLibrary,
          halfLifeDays: s.karmaHalfLifeDays,
        });
      } else {
        // Prewarm kayıt yapmamıştı — kullanıldığı için şimdi kaydet.
        await recordRecommended(recs.map((r) => r.id));
      }
      if (recs.length === 0) {
        useToastStore
          .getState()
          .show(t("home.noData"), "info");
        set({ discovering: false, status: "idle" });
        return;
      }
      rememberRecs(recs);
      // Çeşitlilik: arka arkaya aynı sanatçı gelmesin.
      const items: QueueItem[] = spreadByArtist(recs).map((r) =>
        toRecItem(r, DISCOVERY_ID)
      );
      const first = items[0];
      set({
        queue: items,
        queueIndex: 0,
        current: first,
        status: "loading",
        positionMs: 0,
        durationMs: first.durationMs,
        radioActive: true,
        radioPlaylistId: DISCOVERY_ID,
        shuffleMode: "smart",
        discovering: false,
        error: null,
        discoverySeedArtists: seedArtistsOf(recs),
      });
      scheduleLoad(first);
      // Sıradaki TÜM önerileri önden hazırla (backend eşzamanlılık sınırı sırayla
      // indirir; hızlı geçişte gecikme olmaz).
      if (isTauri()) {
        for (const it of items.slice(1)) {
          invoke("prefetch_audio", {
            sourceId: it.sourceId,
            cookiesBrowser: s.cookiesBrowser,
          }).catch(() => {});
        }
      }
      // Sonraki sefer için yeni parti hazırla (arka planda).
      void prewarmDiscovery();
    } catch (e) {
      console.error("[resonance] keşif başlatılamadı:", e);
      set({ discovering: false, status: "idle" });
    }
  },

  // Filtreleri değiştir. Hazır bekleyen prewarm partisi ESKİ filtrelerle
  // kurulduğu için ÇÖPE ATILIR — yoksa kullanıcı "rock" seçtiğinde önüne
  // filtresiz hazırlanmış eski parti gelirdi.
  // Tarz kilidi değişince hazır prewarm partisi ESKİ tarzla kurulmuş olur.
  setLockedSeedArtist: (artist) => {
    set({ lockedSeedArtist: artist ? artist.toLowerCase() : null });
    discoveryPrewarm = null;
  },

  setDiscoveryFilters: (ids) => {
    set({ discoveryFilters: ids });
    discoveryPrewarm = null;
  },

  // "Bu tarzı beğenmedim" → sırayı at, BAŞKA sanatçıların radyolarından yeni
  // parti kur. Şu anki partiyi getiren seed sanatçıları dışlanır, böylece gelen
  // tarz gerçekten değişir (yoksa aynı güçlü sinyaller aynı radyoları açardı).
  // ⭐ "BUNU DAHA ÇOK BÖYLE" (v1.8.2).
  //
  // Tarz kilidi zaten vardı ama TÜM partiyi yeniden kuruyor — çalan şarkı da
  // gidiyordu. Kullanıcının istediği daha yumuşak bir müdahale: "şu an çalan
  // kalsın, SONRASI böyle devam etsin."
  //
  // Üç şey birden yapar:
  //  1. Kalıcı karar: sanatçıya "daha çok öner" (artist_prefs, senkronlanır).
  //  2. Oturum modu: bu tarza güçlü pozitif sinyal (lib/mood.ts).
  //  3. Kuyruğun KALANINI o tohumla yeniden doldurur; çalan parça ve öncesi
  //     olduğu gibi kalır.
  moreLikeThis: async (item) => {
    const artist = item.seedArtist || item.artist;
    if (!artist || get().discovering) return;
    const s = useSettingsStore.getState();
    set({ discovering: true });
    try {
      await setArtistPref(artist, PREF_MORE);
      noteListen(item.seedArtist, 1); // "sonuna kadar dinlendi" kadar güçlü
      set({ lockedSeedArtist: artist });

      const st = get();
      const keep = st.queue.slice(0, st.queueIndex + 1);
      const recs = await getRecommendations({
        playlistId: st.radioPlaylistId ?? DISCOVERY_ID,
        filters: st.discoveryFilters,
        lockedSeedArtist: artist,
        excludeIds: new Set<string>([
          ...st.skippedRecIds,
          ...recommendedThisSession,
          ...keep.map((k) => k.id),
        ]),
        excludeCores: buildExcludeCores(),
        limit: TARGET_QUEUE_AHEAD,
        useYouTube: s.recYouTube,
        useLibrary: s.recLibrary,
        halfLifeDays: s.karmaHalfLifeDays,
      });
      if (recs.length === 0) {
        useToastStore.getState().show(t("discover.moreLikeEmpty"), "info");
        return;
      }
      rememberRecs(recs);
      const items = spreadByArtist(recs).map((r) =>
        toRecItem(r, st.radioPlaylistId ?? DISCOVERY_ID)
      );
      set({
        queue: [...keep, ...items],
        // queueIndex DEĞİŞMEZ: çalan şarkı yerinde kalır.
        discoverySeedArtists: [artist],
      });
      useToastStore
        .getState()
        .show(t("discover.moreLikeDone", { artist }), "success");
      scheduleLoadPrefetchOnly();
    } catch (e) {
      console.error("[resonance] tarz yönlendirme başarısız:", e);
    } finally {
      set({ discovering: false });
    }
  },

  rerollDiscovery: async () => {
    if (get().discovering) return; // arka arkaya basışları yut
    const s = useSettingsStore.getState();
    set({ discovering: true });
    try {
      // Mevcut partiyi getiren seed sanatçılar + kuyruktaki parçalar dışlanır.
      const prevSeeds = new Set(get().discoverySeedArtists);
      const recs = await getRecommendations({
        playlistId: DISCOVERY_ID,
        filters: get().discoveryFilters,
        lockedSeedArtist: get().lockedSeedArtist ?? undefined,
        excludeIds: new Set<string>([
          ...get().skippedRecIds,
          ...recommendedThisSession,
        ]),
        excludeCores: buildExcludeCores(),
        excludeSeedArtists: prevSeeds,
        limit: TARGET_QUEUE_AHEAD,
        useYouTube: s.recYouTube,
        useLibrary: s.recLibrary,
        halfLifeDays: s.karmaHalfLifeDays,
      });
      if (recs.length === 0) {
        useToastStore
          .getState()
          .show(t("queue.noOtherStyle"), "info");
        set({ discovering: false });
        return;
      }
      rememberRecs(recs);
      const items: QueueItem[] = spreadByArtist(recs).map((r) =>
        toRecItem(r, DISCOVERY_ID)
      );
      const first = items[0];
      set({
        queue: items,
        queueIndex: 0,
        current: first,
        status: "loading",
        positionMs: 0,
        durationMs: first.durationMs,
        radioActive: true,
        radioPlaylistId: DISCOVERY_ID,
        shuffleMode: "smart",
        discovering: false,
        error: null,
        discoverySeedArtists: seedArtistsOf(recs),
      });
      scheduleLoad(first);
      if (isTauri()) {
        for (const it of items.slice(1)) {
          invoke("prefetch_audio", {
            sourceId: it.sourceId,
            cookiesBrowser: s.cookiesBrowser,
          }).catch(() => {});
        }
      }
      const styles = seedArtistsOf(recs);
      useToastStore
        .getState()
        .show(
          styles.length > 0
            ? t("queue.newStyle", { artists: styles.join(", ") })
            : t("queue.newBatch"),
          "info"
        );
    } catch (e) {
      console.error("[resonance] reroll başarısız:", e);
      set({ discovering: false });
    }
  },

  // Açılışta son çalan şarkıyı DURAKLATILMIŞ geri yükle (çalmaz). Play'e
  // basılınca kaldığı pozisyondan yüklenir.
  restoreState: (track, positionMs) => {
    const item = toQueueItem(track);
    hasLoaded = false;
    resumeMsPending = positionMs;
    set({
      queue: [item],
      queueIndex: 0,
      current: item,
      status: "paused",
      positionMs,
      durationMs: track.durationMs,
    });
  },

  // Açılışta son Keşfet kuyruğunu DURAKLATILMIŞ geri yükle (çalmaz; play'e
  // basınca kaldığı pozisyondan devam). Kuyruk aynen gelir → reroll atmadıkça
  // değişmez. Prewarm'a dokunmaz; Keşfet zaten aktif sayılır.
  // Cihazlar arası devam: kuyruğun tamamı gelir, DURAKLATILMIŞ kurulur.
  // Otomatik çalmaya başlamaz — kullanıcı başka bir cihazın önünde olabilir.
  restoreQueue: (queue, index, positionMs) => {
    if (queue.length === 0) return;
    const items = queue.map((i) => ({ ...i, uid: crypto.randomUUID() }));
    const idx = Math.min(Math.max(0, index), items.length - 1);
    set({
      queue: items,
      queueIndex: idx,
      current: items[idx],
      status: "paused",
      positionMs,
      durationMs: items[idx].durationMs,
      radioActive: false,
      radioPlaylistId: null,
      error: null,
    });
    resumeMsPending = positionMs;
  },

  restoreDiscovery: (state) => {
    const items: QueueItem[] = state.queue.map((it) => ({
      ...it,
      uid: crypto.randomUUID(),
    }));
    if (items.length === 0) return;
    const idx = Math.min(Math.max(0, state.queueIndex), items.length - 1);
    const first = items[idx];
    hasLoaded = false;
    resumeMsPending = state.positionMs;
    rememberRecs(
      items
        .filter((i) => i.isRecommendation)
        .map((i) => ({ ...i, recSource: i.recSource!, reason: { key: "rec.fromPlaylist" } }))
    );
    set({
      queue: items,
      queueIndex: idx,
      current: first,
      status: "paused",
      positionMs: state.positionMs,
      durationMs: first.durationMs,
      radioActive: true,
      radioPlaylistId: DISCOVERY_ID,
      shuffleMode: "smart",
      discoverySeedArtists: state.seedArtists ?? [],
      // Filtreler de geri gelmeli: yoksa besleme (refillRadio) filtresiz devam
      // eder ve birkaç şarkı sonra seçtiğin tür sessizce kaybolur.
      discoveryFilters: state.filters ?? [],
    });
    // Sıradakileri önden indir (play'e basınca hazır olsun).
    if (isTauri()) {
      const s = useSettingsStore.getState();
      for (const it of items.slice(idx, idx + 5)) {
        invoke("prefetch_audio", {
          sourceId: it.sourceId,
          cookiesBrowser: s.cookiesBrowser,
        }).catch(() => {});
      }
    }
  },

  toggle: () => {
    const { status, current, queue, queueIndex } = get();

    // ⚠️ YÜKLEME SÜRERKEN İKİNCİ BASIŞ (v1.8.5 düzeltmesi).
    // İlk basış indirmeyi başlatıyor; yavaş bir bağlantıda (Windows'ta sık)
    // kullanıcı sabırsızlanıp tekrar basınca eski kod `audio_play` çağırıp
    // durumu "playing" yapıyordu — ama ses motoruna henüz HİÇBİR ŞEY
    // yüklenmediği için ses gelmiyor, tick de akmıyordu: oynatıcı "çalıyor"
    // görünüp sessiz kalıyordu. Yükleme bitene kadar basışı yut.
    if (status === "loading") {
      // ⚠️ AMA SONSUZA KADAR DEĞİL: yükleme takıldıysa (ağ hatası, ölü
      // yt-dlp süreci) bu erken dönüş oynat tuşunu KALICI olarak öldürüyordu.
      // Birkaç saniye sonra ikinci basış "yeniden dene" anlamına gelir.
      const stuckFor = Date.now() - loadingSince;
      if (stuckFor < 4000) return;
      const again = get().current ?? get().queue[get().queueIndex];
      if (!again) return;
      useToastStore.getState().show(t("player.retrying"), "info");
      scheduleLoad(again, get().positionMs, true);
      return;
    }

    // Kuyruk var ama `current` boşsa (bazı geri yükleme yolları yalnız kuyruğu
    // kuruyor) play tuşu SESSİZCE hiçbir şey yapmıyordu.
    const item = current ?? queue[queueIndex] ?? queue[0];
    if (!item) return;
    if (!current) set({ current: item });

    if (status === "playing") {
      if (isTauri()) invoke("audio_pause").catch(() => {});
      set({ status: "paused" });
    } else {
      // Henüz hiç yüklenmediyse (açılış resume) kaldığı pozisyondan yükle.
      if (!hasLoaded) {
        set({ status: "loading" });
        scheduleLoad(item, resumeMsPending);
        resumeMsPending = 0;
      } else {
        if (isTauri()) invoke("audio_play").catch(() => {});
        set({ status: "playing" });
      }
    }
  },

  next: (reason = "next") => {
    const endedNaturally = reason === "ended";
    // Crossfade geçişinde reason "ended" gelir: kullanıcı ATLAMADI, şarkı
    // bitti → skip cezası ve mod sinyali yazılmamalı.
    recordOutgoing(get(), reason);
    const { queue, queueIndex, shuffleMode, repeat, radioActive } = get();
    if (queue.length === 0) return;

    if (repeat === "one") {
      // Kuyruk dışarıdan değişmiş olabilir (öğe silme / uzak kuyruk devralma):
      // geçersiz indeks `scheduleLoad(undefined)` ile çökerdi.
      const cur = queue[queueIndex];
      if (!cur) return;
      set({ status: "loading", positionMs: 0 });
      scheduleLoad(cur);
      return;
    }

    let nextIdx: number;
    // "shuffle" modunda rastgele sonraki; "smart" modunda (radyo aktif) öneriler
    // zaten serpiştirilmiş olduğundan SIRALI ilerle + refill devam etsin.
    if (shuffleMode === "shuffle" && !radioActive) {
      nextIdx =
        queue.length === 1
          ? queueIndex
          : (() => {
              let r = queueIndex;
              while (r === queueIndex)
                r = Math.floor(Math.random() * queue.length);
              return r;
            })();
    } else {
      nextIdx = queueIndex + 1;
      if (nextIdx >= queue.length) {
        if (repeat === "all") nextIdx = 0;
        else if (radioActive) {
          // Radyo/keşif: kuyruk bitti → besle ve ilk yeni öneriye otomatik geç.
          set({ status: "loading", positionMs: 0 });
          refillRadio(true);
          return;
        } else {
          // ⭐ KUYRUK SONU DAVRANIŞI (v1.8.3, Ayarlar → Çalma).
          // Eskiden tek seçenek vardı: sus. Listeyi bitirince müziğin kesilmesi
          // yerine öneriyle devam etmek (varsayılan) ya da listeyi baştan
          // almak artık seçilebiliyor.
          const behavior = useSettingsStore.getState().queueEndBehavior;
          if (behavior === "repeat" && queue.length > 0) {
            nextIdx = 0;
          } else if (behavior === "recommend") {
            set({ status: "loading", positionMs: 0, radioActive: true });
            refillRadio(true);
            return;
          } else {
            if (isTauri()) invoke("audio_stop").catch(() => {});
            set({ status: "idle", positionMs: 0 });
            return;
          }
        }
      }
    }
    const item = queue[nextIdx];
    set({
      queueIndex: nextIdx,
      current: item,
      status: "loading",
      positionMs: 0,
      durationMs: item.durationMs,
    });
    scheduleLoad(item, 0, endedNaturally);
    // Radyo/keşifte sıradaki şarkı sayısı hedefin (20) altına düşünce hemen
    // tamamla — sırada hep ~20 yüklü şarkı dursun.
    if (radioActive && queue.length - nextIdx - 1 < TARGET_QUEUE_AHEAD) {
      refillRadio();
    }
  },

  prev: () => {
    const { queue, queueIndex, positionMs } = get();
    if (queue.length === 0) return;
    if (positionMs > 3000) {
      get().seek(0);
      return;
    }
    // Düzeltme penceresini başlat: hemen ardından "sonraki"ye basılırsa bu bir
    // yanlış-tuş düzeltmesidir, beğenmeme değil (bkz. recordOutgoing).
    lastPrevAt = Date.now();
    recordOutgoing(get(), "prev");
    const prevIdx = queueIndex - 1 < 0 ? 0 : queueIndex - 1;
    const item = queue[prevIdx];
    set({
      queueIndex: prevIdx,
      current: item,
      status: "loading",
      positionMs: 0,
      durationMs: item.durationMs,
    });
    scheduleLoad(item);
  },

  // Kuyrukta belirli bir indekse atla ve çal (Sıra panelinden tıklama).
  jumpTo: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    recordOutgoing(get(), "jump");
    const item = queue[index];
    set({
      queueIndex: index,
      current: item,
      status: "loading",
      positionMs: 0,
      durationMs: item.durationMs,
    });
    scheduleLoad(item);
  },

  // Bir öğeyi kuyruktan çıkar (çalan öğe çıkarılamaz). current'ı takip eder.
  removeFromQueue: (uid) => {
    const { queue, queueIndex, current } = get();
    if (current?.uid === uid) return;
    const idx = queue.findIndex((i) => i.uid === uid);
    if (idx < 0) return;
    const nextQueue = queue.filter((i) => i.uid !== uid);
    const nextIndex = idx < queueIndex ? queueIndex - 1 : queueIndex;
    set({ queue: nextQueue, queueIndex: nextIndex });
  },

  // Kuyrukta öğe taşı (sürükle-bırak). Çalan öğenin indeksi korunur.
  moveInQueue: (from, to) => {
    const { queue, current } = get();
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= queue.length ||
      to >= queue.length
    )
      return;
    const nq = [...queue];
    const [moved] = nq.splice(from, 1);
    nq.splice(to, 0, moved);
    // ⚠️ findIndex -1 dönerse indeks BOZULUR (queue[-1] = undefined → sonraki
    // yükleme çöker). Bulunamazsa eski indekste kal.
    const found = current ? nq.findIndex((i) => i.uid === current.uid) : -1;
    set({ queue: nq, queueIndex: found >= 0 ? found : get().queueIndex });
  },

  seek: (ms) => {
    set({ positionMs: ms });
    if (isTauri()) invoke("audio_seek", { ms: Math.floor(ms) }).catch(() => {});
  },

  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v));
    set({ volume: vol, muted: false });
    pushVolume(); // parça kazancıyla çarpılır (ses eşitleme)
    persistVolume(vol);
  },

  toggleMute: () => {
    set({ muted: !get().muted });
    pushVolume();
  },

  // Karışık modunu döndür: off → shuffle → smart → off.
  cycleShuffle: () => {
    const { shuffleMode, radioActive, radioPlaylistId } = get();
    // ⭐ Keşfet'te karışık tuşu KİLİTLİ. Keşfet doğası gereği akıllı-karışık +
    // sürekli öneri akışıdır; buradan "off"a düşürmek radioActive'i kapatıp
    // queueIndex sonrası TÜM önerileri siler. Keşfet'te kuyruğun tamamı öneri
    // olduğu için bu Keşfet'i çökertip "reset" atmasına yol açıyordu. Modu
    // bozmadan smart'ta tut, kullanıcıya nedenini kısaca bildir.
    if (radioActive && radioPlaylistId === DISCOVERY_ID) {
      useToastStore.getState().show(t("player.discoveryShuffleLocked"), "info");
      return;
    }
    if (shuffleMode === "off") {
      set({ shuffleMode: "shuffle" });
    } else if (shuffleMode === "shuffle") {
      // shuffle → smart: o anki kuyruk bağlamında öneri serpiştirmeyi başlat.
      const playlistId = get().current?.playlistId;
      set({ shuffleMode: "smart" });
      if (playlistId) {
        set({ radioActive: true, radioPlaylistId: playlistId });
        fetchAndInterleave(playlistId);
      } else {
        // Kuyruk bir listeye bağlı değil → serpiştirilecek bağlam yok, öneri gelmez.
        useToastStore
          .getState()
          .show(t("player.smartShuffleNeedsList"), "info");
      }
    } else {
      // smart → off: radyoyu kapat; kuyrukta queueIndex SONRASI, henüz ÇALINMAMIŞ
      // önerileri kuyruktan çıkar (kalan asıl parçalar korunur).
      const { queue, queueIndex, current } = get();
      const filtered = queue.filter(
        (item, idx) => !(idx > queueIndex && item.isRecommendation)
      );
      const newIndex = current
        ? filtered.findIndex((i) => i.uid === current.uid)
        : queueIndex;
      set({
        queue: filtered,
        queueIndex: newIndex >= 0 ? newIndex : queueIndex,
        radioActive: false,
        radioPlaylistId: null,
        shuffleMode: "off",
      });
    }
  },
  cycleRepeat: () => {
    const cur = get().repeat;
    const idx = repeatOrder.indexOf(cur);
    set({ repeat: repeatOrder[(idx + 1) % repeatOrder.length] });
  },
}));

// Ses thread'inden gelen olayları dinle (uygulama açılışında bir kez).
let initialized = false;
// Arka plan modunda pozisyon güncellemesini kısmak için son uygulanan tick zamanı.
let lastTickApplied = 0;
export async function initPlayer() {
  if (initialized || !isTauri()) return;
  initialized = true;

  await listen<{ position_ms: number; duration_ms: number; playing: boolean }>(
    "playback-tick",
    (e) => {
      const { position_ms, duration_ms, playing } = e.payload;
      const s = usePlayerStore.getState();
      const patch: Partial<PlayerState> = {};
      // Arka plandayken (odak yok) pozisyon güncellemesini en fazla saniyede 1
      // yap → gereksiz re-render'ları kes, GPU/CPU tasarrufu. playing/status ve
      // süre güncellemeleri her zaman geçer.
      const bg = useAppStore.getState().backgrounded;
      const nowMs = Date.now();
      if (!bg || nowMs - lastTickApplied >= 1000) {
        patch.positionMs = position_ms;
        lastTickApplied = nowMs;
      }
      if (duration_ms > 0) patch.durationMs = duration_ms;
      if (playing) {
        patch.status = "playing";
        consecutiveErrors = 0; // başarılı çalma → hata sayaçlarını sıfırla
        loadFailCount = 0;
      } else if (s.status === "playing") patch.status = "paused";
      usePlayerStore.setState(patch);
      // Çalarken pozisyonu periyodik kaydet (kaldığın yerden devam).
      if (playing) persistPlaybackState();

      // ⭐ CROSSFADE: parça bitmeye "fade süresi" kala sıradakine GEÇ.
      // `track-ended` beklenirse geçiş sert olur; erken geçince ses motoru
      // eskiyi söndürürken yeniyi açar (audio.rs).
      if (playing && duration_ms > 0) {
        const fadeMs = crossfadeMs();
        const remain = duration_ms - position_ms;
        // ⚠️ "Şarkı bitince dur" AÇIKSA crossfade ile erken geçme: geçiş
        // `track-ended` yerine buradan olurdu ve uyku isteği SESSİZCE
        // yok sayılıp müzik devam ederdi.
        if (
          fadeMs > 0 &&
          remain > 0 &&
          remain <= fadeMs &&
          !crossfadeArmed &&
          !s.sleepAfterTrack
        ) {
          crossfadeArmed = true;
          // "ended" olarak say: bu kullanıcının ATLAMASI değil, şarkı bitti.
          usePlayerStore.getState().next("ended");
        }
      }
    }
  );

  // ⚠️ ÇIKIŞ CİHAZI MÜZİĞE UYGUN DEĞİLSE KULLANICIYA SÖYLE.
  // Oyuncu kulaklıkları mikrofon/sohbet modundayken işletim sistemine yalnız
  // "16 kHz mono" sunabiliyor; o anda açılan uygulama müziği telefon
  // kalitesinde çalar. Sebebi görünmediği için "uygulamanın sesi bozuk"
  // sanılıyordu (ÖLÇÜLDÜ: Arctis Nova 5, 16000 Hz 1 kanal).
  await listen<string>("audio-output-warning", (e) => {
    useToastStore
      .getState()
      .show(t("player.poorOutput", { info: e.payload }), "error");
  });

  await listen("track-ended", () => {
    const st = usePlayerStore.getState();
    // "Şarkı bitince dur": sıradakine geçme, burada bitir.
    if (st.sleepAfterTrack) {
      if (isTauri()) invoke("audio_stop").catch(() => {});
      usePlayerStore.setState({
        status: "idle",
        positionMs: 0,
        sleepAfterTrack: false,
      });
      return;
    }
    st.next("ended");
  });

  // ⭐ ALTERNATİF KAYNAK BULUNDU: bu şarkı artık BAŞKA bir videodan çalıyor.
  // `tracks` satırını güncellemezsek her seferinde aynı ölü video yeniden
  // denenir (ve her seferinde alternatif aramanın maliyeti ödenir).
  await listen<{ trackId: string; sourceId: string; title: string }>(
    "track-relinked",
    (e) => {
      const { trackId, sourceId } = e.payload;
      void relinkTrack(trackId, sourceId);
      // Bellekteki kuyruk da güncellensin: sıradaki çalmalar doğrudan yeni
      // kaynağı kullansın.
      const st = usePlayerStore.getState();
      const patch = (i: QueueItem) =>
        i.id === trackId ? { ...i, sourceId } : i;
      usePlayerStore.setState({
        queue: st.queue.map(patch),
        current: st.current ? patch(st.current) : null,
      });
    }
  );

  await listen<string>("playback-loading", () => {
    usePlayerStore.setState({ status: "loading" });
  });

  await listen<string>("playback-error", (e) => {
    consecutiveErrors++;
    const s = usePlayerStore.getState();
    // Bozuk/çalınamayan şarkıyı atla (kuyruk takılmasın); art arda 3 hatadan
    // sonra dur ki sonsuz döngü olmasın.
    if (consecutiveErrors <= 3 && s.queue.length > 1) {
      useToastStore.getState().show(t("player.trackFailed"), "error");
      suppressMoodSignal();
      s.next();
    } else {
      useToastStore
        .getState()
        .show(t("player.playFailed") + (e.payload ? `: ${e.payload}` : ""), "error");
      usePlayerStore.setState({ status: "idle", error: e.payload });
    }
  });

  // --- OS MEDYA OTURUMU (asıl medya tuşu yolu) ---
  // Rust tarafı (media_controls.rs) macOS Now Playing / Windows SMTC'ye bağlanır
  // ve tuşa basılınca "media-control" olayı yollar. Global hotkey'in AKSİNE:
  //  • macOS'ta F7/F9 (prev/next) burada ÇALIŞIR — sistem olayları buraya düşer.
  //  • Windows'ta tam ekran oyun raw input alsa bile ÇALIŞIR (SMTC OS seviyesi).
  await listen<string>("media-control", (e) => {
    const p = usePlayerStore.getState();
    switch (e.payload) {
      case "play":
      case "pause":
      case "toggle":
        p.toggle();
        break;
      case "next":
        p.next();
        break;
      case "previous":
        p.prev();
        break;
      case "stop":
        if (p.status === "playing") p.toggle();
        break;
    }
  });

  // Çalan parça / durum değişince OS'a bildir (kilit ekranı + oynat-duraklat ikonu).
  let lastSynced = "";
  usePlayerStore.subscribe((st) => {
    const key = `${st.current?.id ?? ""}|${st.status}`;
    if (key === lastSynced) return;
    lastSynced = key;
    syncMediaSession(st.current, st.status);
  });

  // Medya tuşları — YEDEK yol (global hotkey). OS medya oturumu kurulamazsa
  // (ör. eski Windows, izin sorunu) yine de çalışsın diye tutuluyor. Aynı tuş
  // iki yoldan gelirse çift tetikleme olmaz: SMTC/Now Playing tuşu tüketir.
  const mediaKeys: [string, () => void][] = [
    ["MediaPlayPause", () => usePlayerStore.getState().toggle()],
    ["MediaTrackNext", () => usePlayerStore.getState().next()],
    ["MediaTrackPrevious", () => usePlayerStore.getState().prev()],
  ];
  for (const [key, fn] of mediaKeys) {
    try {
      await register(key, (e) => {
        if (e.state === "Pressed") fn();
      });
    } catch (err) {
      console.error(`[resonance] '${key}' kaydedilemedi:`, err);
    }
  }

}

// --- OS medya oturumu (macOS Now Playing / Windows SMTC) ---
// Kilit ekranı/Control Center'da şarkı bilgisini gösterir ve medya tuşlarının
// asıl kaynağıdır (bkz. src-tauri/src/media_controls.rs — global hotkey yetmiyordu).
function syncMediaSession(item: QueueItem | null, status: PlaybackStatus) {
  if (!isTauri()) return;
  if (item) {
    invoke("media_set_metadata", {
      title: item.title,
      artist: item.artist,
      album: item.album ?? "",
      artUrl: item.thumbnail ?? "",
    }).catch(() => {});
  }
  invoke("media_set_playback", {
    playing: status === "playing",
    stopped: !item || status === "idle",
  }).catch(() => {});
}

// Art arda çalma hatası sayacı (otomatik atlamada sonsuz döngüyü önler).
let consecutiveErrors = 0;
