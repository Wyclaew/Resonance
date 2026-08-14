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
import { noteListen } from "../lib/mood";
import { publishNowPlaying } from "../lib/nowPlaying";
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

  // Uyku zamanlayıcı
  sleepTimerEndsAt: number | null;
  setSleepTimer: (minutes: number | null) => void;

  error: string | null;

  playNow: (
    track: Track,
    queue?: Track[],
    playlistId?: string,
    /** Bu milisaniyeden başlat (cihazlar arası "kaldığın yerden devam"). */
    startMs?: number
  ) => void;
  startSmartShuffle: (tracks: KarmaTrack[], playlistId: string) => Promise<void>;
  startDiscovery: (opts?: { force?: boolean }) => Promise<void>;
  rerollDiscovery: () => Promise<void>;
  setDiscoveryFilters: (ids: string[]) => void;
  restoreState: (track: Track, positionMs: number) => void;
  restoreDiscovery: (state: DiscoveryResume) => void;
  toggle: () => void;
  next: () => void;
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

function loadAndPlay(item: QueueItem, startMs = 0) {
  if (!isTauri()) return;
  hasLoaded = true;
  const myToken = ++currentLoadToken;
  invoke("play_track", {
    input: {
      sourceId: item.sourceId,
      durationMs: item.durationMs,
      trackId: item.id,
      resumeMs: Math.floor(startMs),
    },
    cookiesBrowser: useSettingsStore.getState().cookiesBrowser,
  }).catch((e) => {
    // Bu yükleme hâlâ güncel mi? Değilse (kullanıcı başka şarkıya geçti) DOKUNMA.
    if (myToken !== currentLoadToken) return;
    // İndirilemeyen şarkı (silinmiş/geçici hata) kuyruğu TIKAMASIN: sıradaki varsa
    // atla. Art arda çok hata olursa dur ki sonsuz döngü olmasın.
    console.error("[resonance] play_track hatası:", e);
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
      useToastStore.getState().show(`Şarkı yüklenemedi — ${String(e)}`, "error");
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
function scheduleLoad(item: QueueItem, startMs = 0) {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => loadAndPlay(item, startMs), 180);
  // Prefetch'i daha uzun beklet: kullanıcı hızlıca şarkı geçerken geçilen
  // şarkılar boşuna indirilmesin — yalnızca durduktan sonra sıradakiler hazırlanır.
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => prefetchNext(), 1500);
}

let sleepTimeout: ReturnType<typeof setTimeout> | undefined;

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
}

// Sıradaki parçaları arka planda indir/hazırla → hızlı arka arkaya geçişler de
// anlık olur. 3 önden hazırlanır (zaten cache'tekiler yt-dlp bile çağırmaz).
function prefetchNext() {
  if (!isTauri()) return;
  // Ekran koruyucu aktifken ağır yt-dlp çağrılarını durdur (CPU/disk tasarrufu).
  if (useAppStore.getState().idle) return;
  if (!useSettingsStore.getState().prefetchEnabled) return;
  const { queue, queueIndex } = usePlayerStore.getState();
  const cookiesBrowser = useSettingsStore.getState().cookiesBrowser;
  for (let i = 1; i <= 3; i++) {
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
  muted: false,
  shuffleMode: "off",
  repeat: "off",

  radioActive: false,
  radioPlaylistId: null,
  skippedRecIds: new Set(),
  discoverySeedArtists: [],
  discoveryFilters: [],
  discovering: false,

  sleepTimerEndsAt: null,
  setSleepTimer: (minutes) => {
    clearTimeout(sleepTimeout);
    if (minutes == null) {
      set({ sleepTimerEndsAt: null });
      return;
    }
    const ms = minutes * 60000;
    set({ sleepTimerEndsAt: Date.now() + ms });
    sleepTimeout = setTimeout(() => {
      if (isTauri()) invoke("audio_pause").catch(() => {});
      set({ status: "paused", sleepTimerEndsAt: null });
    }, ms);
  },

  error: null,

  playNow: (track, queue, playlistId, startMs = 0) => {
    const items = (queue ?? [track]).map((t) => toQueueItem(t, playlistId));
    const idx = Math.max(0, items.findIndex((i) => i.id === track.id));
    const current = items[idx];
    set({
      queue: items,
      queueIndex: idx,
      current,
      status: "loading",
      positionMs: startMs,
      durationMs: track.durationMs,
      radioActive: false,
      radioPlaylistId: null,
      error: null,
    });
    scheduleLoad(current, startMs);
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
  setDiscoveryFilters: (ids) => {
    set({ discoveryFilters: ids });
    discoveryPrewarm = null;
  },

  // "Bu tarzı beğenmedim" → sırayı at, BAŞKA sanatçıların radyolarından yeni
  // parti kur. Şu anki partiyi getiren seed sanatçıları dışlanır, böylece gelen
  // tarz gerçekten değişir (yoksa aynı güçlü sinyaller aynı radyoları açardı).
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
    const { status, current } = get();
    if (!current) return;
    if (status === "playing") {
      if (isTauri()) invoke("audio_pause").catch(() => {});
      set({ status: "paused" });
    } else {
      // Henüz hiç yüklenmediyse (açılış resume) kaldığı pozisyondan yükle.
      if (!hasLoaded) {
        set({ status: "loading" });
        scheduleLoad(current, resumeMsPending);
        resumeMsPending = 0;
      } else {
        if (isTauri()) invoke("audio_play").catch(() => {});
        set({ status: "playing" });
      }
    }
  },

  next: () => {
    recordOutgoing(get(), "next");
    const { queue, queueIndex, shuffleMode, repeat, radioActive } = get();
    if (queue.length === 0) return;

    if (repeat === "one") {
      const cur = queue[queueIndex];
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
          if (isTauri()) invoke("audio_stop").catch(() => {});
          set({ status: "idle", positionMs: 0 });
          return;
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
    scheduleLoad(item);
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
    const nextIndex = current
      ? nq.findIndex((i) => i.uid === current.uid)
      : get().queueIndex;
    set({ queue: nq, queueIndex: nextIndex });
  },

  seek: (ms) => {
    set({ positionMs: ms });
    if (isTauri()) invoke("audio_seek", { ms: Math.floor(ms) }).catch(() => {});
  },

  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v));
    set({ volume: vol, muted: false });
    if (isTauri()) invoke("audio_set_volume", { volume: vol }).catch(() => {});
    persistVolume(vol);
  },

  toggleMute: () => {
    const { muted, volume } = get();
    const nextMuted = !muted;
    set({ muted: nextMuted });
    if (isTauri())
      invoke("audio_set_volume", { volume: nextMuted ? 0 : volume }).catch(
        () => {}
      );
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
    }
  );

  await listen("track-ended", () => {
    usePlayerStore.getState().next();
  });

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
