import { invoke } from "@tauri-apps/api/core";
import type { Track, RecReason } from "../types";
import { getDb, isTauri } from "./db";
import { decayWeight } from "./karma";
import { useSettingsStore } from "../store/useSettingsStore";
import { t, dayNameOf, type Lang } from "./i18n";
import { getDeviceId, newUid } from "./device";
import { notifyLocalChange } from "./sync/engine";
import { isProbeCandidate, moodMultiplier } from "./mood";
import { queriesFor } from "./filters";
import { buildTasteProfile, tasteBoost } from "./taste";
import { acceptanceBoost, buildAcceptance } from "./acceptance";
import { isBlocked, loadBlockedArtists } from "./blocked";

// Resonance öneri motoru (M4).
// "Hangi gün/saat hangi şarkıya oy verdin" sinyalinden sanatçı yakınlığı
// çıkarır; o anki bağlama (saat/gün) ağırlık verir. Adaylar kendi
// kütüphanenden ve/veya YouTube benzerlerinden gelir.

export interface Recommendation extends Track {
  recSource: "youtube" | "library";
  // reason ARTIK STRING DEĞİL — {anahtar, parametreler}. Neden: string üretim
  // anındaki dile göre sabitlenirdi; dil sonradan değişince (veya prewarm settings
  // yüklenmeden çalışınca) yanlış dilde kalırdı. Yapısal saklayıp GÖSTERİRKEN
  // çeviriyoruz → dil değişimine ve kalıcı kuyruğa dayanıklı. `dow` sayı olarak
  // saklanır; gün ADI render anında dayNameOf ile üretilir.
  reason: RecReason;
  // Bu öneriyi hangi sanatçının radyosu getirdi ("reroll"da o tarzı dışlamak için).
  seedArtist?: string;
  /** "Modun değişti mi?" denemesi — bilerek mod dışından seçilmiş parça. */
  isProbe?: boolean;
}

// RecReason'i O ANKİ dilde metne çevir (göstericiler bunu çağırır).
// dow → gün ADI render anında üretilir, böylece dil değişince metin de değişir.
export function reasonText(r: RecReason | undefined, lang?: Lang): string {
  if (!r) return "";
  const params: Record<string, string | number> = {};
  if (r.seed !== undefined) params.seed = r.seed;
  if (r.artist !== undefined) params.artist = r.artist;
  if (r.dow !== undefined) params.day = dayNameOf(lang ?? getLang(), r.dow);
  return t(r.key, params);
}
function getLang(): Lang {
  return useSettingsStore.getState().language;
}

interface VoteRow {
  track_id: string;
  value: number;
  created_at: number;
  hour: number;
  dow: number;
  artist: string;
}

interface CandidateRow {
  id: string;
  source: string;
  source_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number;
  thumbnail: string | null;
}

function isWeekend(dow: number): boolean {
  return dow === 0 || dow === 6;
}

// Öneri havuzuna yalnızca GERÇEK şarkılar girsin: süre + başlık/kanal sezgisiyle
// podcast/röportaj/mix/full album/livestream gibi içerikleri ele.
//
// DİKKAT — desenler kelime sınırlı (\b) olmalı, düz `includes` DEĞİL. Eskiden
// düz substring'di ve gerçek şarkıları eliyordu: "hour" → "Hourglass"/"24 Hours",
// "mix" → "Remix"/"Mixed Emotions", "best of" → "The Best of Me".
// \bmix\b bunların hiçbirine takılmaz ama "Summer Mix"i yakalar.
//
// İş bölümü: UZUN içerik (mix, full album, uzun podcast) zaten SÜRE tavanıyla
// elenir. Buradaki desenler ikinci savunma hattı: (a) süresi bilinmeyen (0)
// sonuçlar, (b) süresi şarkı aralığına DÜŞEN müzik-dışı içerik — kısa podcast
// bölümü, röportaj, tepki videosu. Asıl hedef (b).
const NON_SONG_PATTERNS: RegExp[] = [
  // — Uzun/derleme içerik (süre 0 ise buradan yakalanır)
  /\b(mix|megamix|mixtape|nonstop|non-stop|continuous)\b/,
  /\bfull (album|ep|concert|set)\b/,
  /\b(compilation|greatest hits|dj set|all songs)\b/,
  /\btop \d+\b/,
  // "1 Hour of Lofi", "10 Hours Loop" — ama "24 Hours" (Sky Ferreira) GEÇER.
  // Saatlik içerik zaten süre tavanına takılır; bu yalnız süre=0 için yedek.
  /\b\d+\s*hours?\s+(of|loop|nonstop)\b/,
  /\b\d+\s*saat\s+(boyunca|kesintisiz)\b/,
  /\b(live ?stream|canlı yayın)\b/,
  /\bplaylist\b/,

  // — Konuşma içeriği: KISA olabilir, asıl hedef bu
  /\bpodcast\b/,
  /\b(episode|bölüm)\s*#?\s*\d+/, // "Episode 12", "Bölüm 3"
  /\bep\.\s*\d+/, // "Ep. 12"
  /\b(interview|röportaj|söyleşi|sohbet|muhabbet)\b/,
  /\b(talk show|ted talk|konferans|seminer|lecture|sermon|vaaz)\b/,
  /\b(audiobook|audio book|sesli kitap)\b/,
  /\b(asmr|meditation|meditasyon|hypnosis)\b/,
  /\b(reacts? to|reaction video|first reaction)\b/,
  /\b(q&a|soru cevap)\b/,
  // "Nasıl Şarkı Yazılır" → elenir; "Nasıl Geçti Habersiz" (şarkı) → geçer.
  /\btutorial\b/,
  /\bnasıl\b.{0,24}\b(yapılır|yazılır|çalınır|kurulur|olunur)\b/,
  /\b(documentary|belgesel)\b/,
  /\b(explains?|anlatıyor|açıklıyor|yorumluyor)\b/,
  /\b(gündem|son dakika|münazara|tartışma programı)\b/,

  // — Stok / telifsiz "içerik müziği" (gerçek şarkı değil)
  // DİKKAT: tek başına "free" KULLANMA → "Free Bird", "Free" (Florence) elenir.
  // Hepsi iki kelimelik kalıp; gerçek şarkı adlarına çarpma riski çok düşük.
  /\bno copyright\b/,
  /\bcopyright[- ]?free\b/,
  /\broyalty[- ]?free\b/,
  /\bbackground music\b/,
  /\b(vlog|gaming|study|workout) music\b/,
  /\bfree (music|to use|for creators)\b/,
  /\bncs\b/,
  /\bstock music\b/,
  /\bmusic for (videos|content|creators|streamers)\b/,
];
// Kanal adı sinyali: "X Podcast" kanalındaki her şey konuşma içeriğidir.
// Bilerek dar tutuldu — "talk"/"tv"/"fm" gibi kelimeler müzik kanallarında da
// geçtiği için (Kral TV, MTV) yanlış eleme yapar.
const NON_SONG_CHANNEL =
  /\bpodcasts?\b|\bno copyright\b|\bcopyright[- ]?free\b|\broyalty[- ]?free\b|\bncs\b/;

// Süre tavanı 9 dk: kullanıcının 225 parçalık kütüphanesinde 8 dk'yı geçen TEK
// parça var (Master of Puppets, 8:35). Eski 12 dk tavanı gereksiz gevşekti ve
// 10 dk'lık bir podcast'in öneri olarak gelmesine izin verdi.
const MIN_SONG_MS = 40_000;
const MAX_SONG_MS = 9 * 60_000;
function isLikelySong(t: Track): boolean {
  const ms = t.durationMs;
  // Süre 0 = bilinmiyor → eleme, desenlere bırak.
  if (ms > 0 && (ms < MIN_SONG_MS || ms > MAX_SONG_MS)) return false;
  const title = t.title.toLowerCase();
  if (NON_SONG_PATTERNS.some((re) => re.test(title))) return false;
  // t.artist YouTube sonuçlarında kanal/uploader adıdır.
  return !NON_SONG_CHANNEL.test(t.artist.toLowerCase());
}

// Şarkı kimlik anahtarı (başlık+sanatçı, normalize). Aynı şarkının farklı
// YouTube video id'lerini de eşleştirir → mevcut listedeki bir parçanın
// "başka bir kaydı" öneri olarak gelmesin.
function normKey(title: string, artist: string): string {
  return `${title} ${artist}`
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "") // (Official Video), [HD] vb.
    .replace(/[^a-z0-9çğıöşü]+/gi, "")
    .trim();
}

// "Şarkı adı çekirdeği" — SANATÇIDAN BAĞIMSIZ. Aynı şarkının hem farklı
// kayıtlarını (sped up, slowed, remix, official/audio, lyrics, canlı…) hem de
// FARKLI SANATÇILARIN aynı adlı versiyonlarını (cover vb.) tek anahtara indirir.
// Başlıktaki sanatçı kısmı ayıklanır, versiyon etiketleri ve dolgu kelimeleri
// atılır, kalan kelimeler sıralanır:
//   "The Weeknd - Blinding Lights (Official Video)" → "blinding lights"
//   "Blinding Lights (sped up)"                     → "blinding lights"
//   "Creep (Radiohead Cover)"                       → "creep"
const VERSION_MARKERS =
  /\b(sped ?up|slowed|reverb|remix|cover|lyrics?|official|audio|video|hd|4k|remaster(ed)?|live|acoustic|instrumental|karaoke|8d|nightcore|edit|version|mix|extended|radio|clip|mv|hq|visualizer|performance)\b/gi;
const STOP_WORDS = new Set([
  "the", "a", "an", "feat", "ft", "featuring", "and", "ve", "x", "with",
  "music", "song", "prod", "by", "de", "la", "el",
]);
export function songCore(title: string, artist: string): string {
  const clean = title
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ") // parantez/köşeli içi
    .replace(VERSION_MARKERS, " ");
  const artistKey = artist.toLowerCase().replace(/[^a-z0-9çğıöşü]+/gi, "");
  // "Sanatçı - Şarkı" ya da "Şarkı - Sanatçı": sanatçıya karşılık gelen parçayı at.
  const segs = clean
    .split(/[-–—|:]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  let parts = segs;
  if (segs.length > 1 && artistKey) {
    const kept = segs.filter((sg) => {
      const k = sg.replace(/[^a-z0-9çğıöşü]+/gi, "");
      if (!k) return false;
      // VEVO/Topic gibi kanal adlarını da yakalamak için iki yönlü içerme.
      return !(artistKey.includes(k) || k.includes(artistKey));
    });
    if (kept.length > 0) parts = kept;
  }
  const words = parts
    .join(" ")
    .replace(/[^a-z0-9çğıöşü ]+/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set(words)].sort().join(" ");
}

// Zaman-bağlam ağırlığı: "hangi gün, hangi saat neyi seviyorsun".
//
// TABAN (CONTEXT_FLOOR) neden var: eskiden saf çarpımdı (hourW*dowW). 12 saat
// uzaktaki bir oy exp(-12/3)=0.018 ile neredeyse SIFIRLANIYORDU → sabah 3'te
// uygulamayı açınca öğlen verilmiş tüm oylar yok sayılıp yakınlık havuzu
// boşalıyor, öneri kalitesi çöküyordu. Doğrusu: genel beğeni HER ZAMAN sayılsın
// (taban), o ana denk gelen beğeni ise ÖNE ÇIKSIN (taban üstü çarpan).
//   → skor = 0.25 (genel zevkin) + 0.75 (şu anki bağlama uyum)
const CONTEXT_FLOOR = 0.25;
function contextWeight(
  voteHour: number,
  voteDow: number,
  curHour: number,
  curDow: number
): number {
  const dh = Math.abs(voteHour - curHour);
  const circDh = Math.min(dh, 24 - dh);
  const hourW = Math.exp(-circDh / 3); // ~3 saat içinde güçlü
  const dowW =
    voteDow === curDow ? 1 : isWeekend(voteDow) === isWeekend(curDow) ? 0.6 : 0.35;
  return CONTEXT_FLOOR + (1 - CONTEXT_FLOOR) * hourW * dowW;
}

// SAF bağlam uyumu (tabansız, 0..1): "bu parça TAM ŞU ANA mı ait?".
// Favori dönüşünde kullanılır — orada taban İSTEMEYİZ, çünkü amaç yalnızca
// şu anki gün/saat moduna uyan favorileri geri getirmek.
function contextMatch(
  hour: number,
  dow: number,
  curHour: number,
  curDow: number
): number {
  const dh = Math.abs(hour - curHour);
  const circDh = Math.min(dh, 24 - dh);
  const hourW = Math.exp(-circDh / 3);
  const dowW = dow === curDow ? 1 : isWeekend(dow) === isWeekend(curDow) ? 0.6 : 0.35;
  return hourW * dowW;
}


function toTrack(r: CandidateRow): Track {
  return {
    id: r.id,
    source: r.source as Track["source"],
    sourceId: r.source_id,
    title: r.title,
    artist: r.artist,
    album: r.album ?? undefined,
    durationMs: r.duration_ms,
    thumbnail: r.thumbnail ?? undefined,
  };
}

export interface RecommendOpts {
  playlistId: string;
  excludeIds: Set<string>;
  // Zaten kuyrukta/önerilmiş şarkıların "şarkı adı çekirdekleri" (songCore).
  // ID dışlaması yetmez: aynı şarkının farklı sanatçı/versiyon kaydının ID'si
  // farklıdır → partiler arası tekrarı yalnızca bu engeller.
  excludeCores?: Set<string>;
  // "Reroll": bu sanatçıların radyosunu açma → gelen tarz değişsin (küçük harf).
  excludeSeedArtists?: Set<string>;
  limit: number;
  useYouTube: boolean;
  useLibrary: boolean;
  halfLifeDays: number;
  // false ise kalıcı geçmişe YAZILMAZ (prewarm için: öneriler kullanılmadan
  // "harcanmasın"). Kullanıldığında recordRecommended ile ayrıca kaydedilir.
  record?: boolean;
  /**
   * Keşfet filtreleri (ruh hali + tür anahtarları, `lib/filters.ts`).
   * Boş/undefined → filtre yok, saf öğrenme algoritması çalışır.
   */
  filters?: string[];
  /** Tarz kilidi: bu sanatçının tohum olma ağırlığı çok yükseltilir. */
  lockedSeedArtist?: string;
}

// Önerilen parçaları kalıcı geçmişe yaz (45 gün tekrar önlenir).
export async function recordRecommended(trackIds: string[]): Promise<void> {
  if (!isTauri() || trackIds.length === 0) return;
  try {
    const db = await getDb();
    const now = Date.now();
    for (const id of trackIds) {
      await db.execute(
        `INSERT INTO recommendation_history
           (track_id, recommended_at, uid, device_id, updated_at)
         VALUES ($1, $2, $3, $4, $2)`,
        [id, now, newUid(), getDeviceId()]
      );
    }
    notifyLocalChange();
  } catch (e) {
    console.error("[resonance] öneri geçmişi yazılamadı:", e);
  }
}

// Dış arayüz: önerileri hesaplar VE (record!==false ise) kalıcı geçmişe yazar.
export async function getRecommendations(
  opts: RecommendOpts
): Promise<Recommendation[]> {
  const recs = await computeRecommendations(opts);
  if (recs.length > 0 && opts.record !== false) {
    await recordRecommended(recs.map((r) => r.id));
  }
  return recs;
}

async function computeRecommendations(
  opts: RecommendOpts
): Promise<Recommendation[]> {
  if (!isTauri()) return [];
  const db = await getDb();
  const now = Date.now();
  const d = new Date();
  const curHour = d.getHours();
  const curDow = d.getDay();

  // --- SİNYAL KATMANLARI ---
  // İki ayrı harita, BİLEREK farklı besleniyor (bu ayrım kritik):
  //   • artistAffinity = "KİMİ seviyorum" → hangi radyoları açacağımızı seçer
  //     → o tarzda YENİ şarkılar getirir. Playlist üyeliği burayı besler.
  //   • trackKarma = "HANGİ PARÇAYI seviyorum" → yalnız favori dönüşünde kullanılır.
  //     Playlist üyeliği burayı BESLEMEZ — yoksa listendeki her şarkı "favori"
  //     sayılıp Keşfet kuyruğunu kendi şarkıların doldururdu (kullanıcı bunu
  //     açıkça istemedi: "kendi playlistimdeki aynı şarkılar olacaksa olmasın").
  const artistAffinity = new Map<string, number>();
  const trackKarma = new Map<string, number>();
  // Favori dönüşü için: her parçanın ŞU ANKİ gün/saate en iyi uyumu (0..1).
  const trackContext = new Map<string, number>();
  // Öğrenme katmanlarını tazele (10 dk'da bir; ikisi de tek sorgu).
  await Promise.all([buildTasteProfile(), buildAcceptance(), loadBlockedArtists()]);

  const bumpContext = (id: string, m: number) =>
    trackContext.set(id, Math.max(trackContext.get(id) ?? 0, m));

  // 1) Oy sinyali — en güçlü, açık beğeni.
  const votes = await db.select<VoteRow[]>(
    `SELECT v.track_id, v.value, v.created_at, v.hour, v.dow, t.artist
     FROM votes v JOIN tracks t ON t.id = v.track_id
     WHERE v.deleted = 0`
  );
  for (const v of votes) {
    const w =
      v.value *
      decayWeight(now - v.created_at, opts.halfLifeDays) *
      contextWeight(v.hour, v.dow, curHour, curDow);
    artistAffinity.set(v.artist, (artistAffinity.get(v.artist) ?? 0) + w);
    trackKarma.set(v.track_id, (trackKarma.get(v.track_id) ?? 0) + w);
    if (v.value > 0) bumpContext(v.track_id, contextMatch(v.hour, v.dow, curHour, curDow));
  }

  // 1b) ⭐ PLAYLIST ÜYELİĞİ — "listeme ekledim" = beğeni beyanı.
  // Bu sinyal olmadan algoritma zevkinin YALNIZ oy verdiğin kısmını görüyordu
  // (ölçüm: 8 sanatçı). Playlist'lerde 183 sanatçı var → havuz 23 KATINA çıkar.
  // "Hep aynı tarzı öneriyor" sorununun kök sebebi buydu.
  //
  // Ağırlık oydan düşük (0.6): listeye eklemek beğenidir ama upvote kadar
  // taze/kuvvetli değil. Yarı ömür 4× uzun: liste tercihi KALICIDIR — 3 ay önce
  // eklediğin sanatçıyı hâlâ seviyorsun (oy ise anlık moda daha duyarlı).
  // Bağlam çarpanı YOK: liste üyeliği "kimi sevdiğini" söyler, "ne zaman"ı değil;
  // zaman bilgisi oy ve dinleme geçmişinden gelir.
  const PLAYLIST_SIGNAL = 0.6;
  try {
    const plRows = await db.select<
      { artist: string; added_at: number }[]
    >(
      `SELECT t.artist, pt.added_at
       FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       WHERE t.artist <> '' AND pt.deleted = 0`
    );
    for (const p of plRows) {
      const w =
        PLAYLIST_SIGNAL *
        decayWeight(now - p.added_at, opts.halfLifeDays * 4);
      artistAffinity.set(p.artist, (artistAffinity.get(p.artist) ?? 0) + w);
    }
  } catch {
    /* yoksay */
  }

  // Dinleme davranışı sinyali: oy vermesen bile TAMAMLADIĞIN şarkılar beğeni,
  // ERKEN ATLADIKLARIN olumsuz sayılır. Bu, zevkini oy vermeden de öğrenir →
  // "seveceğin şarkıları" daha isabetli bulur.
  try {
    const plays = await db.select<
      {
        track_id: string;
        ms_played: number;
        played_at: number;
        hour: number;
        dow: number;
        artist: string;
        duration_ms: number;
      }[]
    >(
      `SELECT h.track_id, h.ms_played, h.played_at, h.hour, h.dow,
              t.artist, t.duration_ms
       FROM play_history h JOIN tracks t ON t.id = h.track_id`
    );
    for (const p of plays) {
      const ratio =
        p.duration_ms > 0 ? Math.min(1, p.ms_played / p.duration_ms) : 0;
      // Kademeli sinyal (kaba "beğendi/atladı"dan daha ince):
      //  • < 5 sn çalındı → çok hızlı geçildi, güçlü olumsuz (−0.35)
      //  • oran < %15 → atlama, olumsuz (−0.25)
      //  • oran > %70 → neredeyse tamamlandı, güçlü beğeni (+0.4)
      //  • oran > %40 → yarıdan fazla dinlendi, hafif beğeni (+0.15)
      //  • diğerleri → nötr (0)
      const signal =
        p.ms_played < 5000
          ? -0.35
          : ratio < 0.15
          ? -0.25
          : ratio > 0.7
          ? 0.4
          : ratio > 0.4
          ? 0.15
          : 0;
      if (signal === 0) continue;
      const w =
        signal *
        decayWeight(now - p.played_at, opts.halfLifeDays) *
        contextWeight(p.hour, p.dow, curHour, curDow);
      artistAffinity.set(p.artist, (artistAffinity.get(p.artist) ?? 0) + w);
      trackKarma.set(p.track_id, (trackKarma.get(p.track_id) ?? 0) + w);
      // Yalnız GERÇEKTEN dinlenmişler favori dönüşüne aday olabilir (atlananlar değil).
      if (ratio > 0.7) {
        bumpContext(p.track_id, contextMatch(p.hour, p.dow, curHour, curDow));
      }
    }
  } catch {
    /* play_history yoksa yoksay */
  }

  const recs: Recommendation[] = [];
  // SERT dışlama: bu oturumda/kuyrukta zaten var → asla tekrar.
  const taken = new Set<string>(opts.excludeIds);

  // Kalıcı geçmiş: son 45 günde önerilmiş parçalar (kapat-aç sonrası aynı
  // öneriler tekrar gelmesin).
  //
  // ⚠️ `taken`'a KARIŞTIRMA — ayrı küme: bu engel yalnız YENİ KEŞİFLERE uygulanır.
  // Favoriler (upvote'lu / tamamlanmış) bu engelden MUAFTIR; kullanıcının kararı:
  // "sevdiklerim dönsün, keşifler dönmesin". Sevdiğin şarkı 45 gün boyunca
  // yasaklanırsa "geçen hafta beğendiğim şarkı bu saatte yine gelsin" olamaz.
  const recentlyRecommended = new Set<string>();
  try {
    const RECENT_MS = 45 * 24 * 60 * 60 * 1000;
    const histRows = await db.select<{ track_id: string }[]>(
      `SELECT DISTINCT track_id FROM recommendation_history WHERE recommended_at >= $1`,
      [now - RECENT_MS]
    );
    for (const h of histRows) recentlyRecommended.add(h.track_id);
  } catch {
    /* tablo henüz yoksa yoksay */
  }

  // Mevcut çalan listedeki şarkıların başlık+sanatçı anahtarları. Öneriler bu
  // listeden (farklı video id'li aynı şarkı dahil) GELMESİN — kullanıcı farklı
  // bir listesi varsa öneriler oradan/kütüphaneden gelir.
  const playlistKeys = new Set<string>();
  // Aynı şarkının farklı versiyon/kaydını (cover, sped up, official/audio…) da
  // ele: mevcut liste + öneriler arası "versiyon çekirdeği" tekrar etmesin.
  const takenCores = new Set<string>(opts.excludeCores ?? []);
  const plTrackRows = await db.select<{ title: string; artist: string }[]>(
    `SELECT t.title, t.artist
     FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = $1 AND pt.deleted = 0`,
    [opts.playlistId]
  );
  for (const r of plTrackRows) {
    playlistKeys.add(normKey(r.title, r.artist));
    takenCores.add(songCore(r.title, r.artist));
  }

  // 2) ⭐ FAVORİ DÖNÜŞÜ — "geçen hafta bu saatte sevdiğim şarkı yine gelsin".
  //
  // Kullanıcının isteği: Instagram Reels gibi, hangi GÜN/SAAT ne sevdiğimi öğren
  // ve o bağlam tekrarlayınca o şarkıyı geri getir.
  //
  // ⚠️ İKİ SIKI ŞART (yoksa Keşfet kuyruğunu kullanıcının kendi şarkıları doldurur —
  // açıkça istemediği şey: "kendi playlistimdeki aynı şarkılar olacaksa olmasın"):
  //   1. trackKarma > 0 → parçaya AÇIKÇA oy verilmiş ya da >%70 dinlenmiş olmalı.
  //      Sadece listede olmak YETMEZ (playlist üyeliği trackKarma'yı beslemiyor).
  //   2. contextMatch yüksek → parça ŞU ANKİ gün/saat moduna ait olmalı.
  // Ayrıca kuyruğun en fazla ~%15'i (20'de 3) → Keşfet keşif olarak kalır.
  const FAVORITE_SHARE = 0.15;
  const FAVORITE_MIN_CONTEXT = 0.35; // bu saate gerçekten ait mi?
  if (opts.useLibrary) {
    const favLimit = Math.max(1, Math.round(opts.limit * FAVORITE_SHARE));
    const cands = await db.select<CandidateRow[]>(
      `SELECT DISTINCT t.id, t.source, t.source_id, t.title, t.artist, t.album,
              t.duration_ms, t.thumbnail
       FROM tracks t
       JOIN playlist_tracks pt ON pt.track_id = t.id AND pt.playlist_id <> $1
            AND pt.deleted = 0
       WHERE t.id NOT IN (
         SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 AND deleted = 0
       )`,
      [opts.playlistId]
    );
    const scored = cands
      .map((c) => {
        const tk = trackKarma.get(c.id) ?? 0;
        const ctx = trackContext.get(c.id) ?? 0;
        // Sıralama zaman uyumuna göre: "şu ana ait" favoriler önce.
        return { c, tk, ctx, score: tk * ctx };
      })
      .filter((x) => x.tk > 0 && x.ctx >= FAVORITE_MIN_CONTEXT)
      .sort((a, b) => b.score - a.score);

    // Çeşitlilik: aynı sanatçıdan en fazla 1 favori (kontenjan zaten 3).
    const favArtists = new Set<string>();
    let favAdded = 0;
    for (const { c } of scored) {
      if (favAdded >= favLimit) break;
      // NOT: `recentlyRecommended` KASITLI olarak kontrol edilmiyor — favoriler
      // 45-gün engelinden muaf (yukarıdaki nota bak).
      if (taken.has(c.id)) continue;
      if (playlistKeys.has(normKey(c.title, c.artist))) continue;
      if (takenCores.has(songCore(c.title, c.artist))) continue; // versiyon kopyası
      if (!isLikelySong(toTrack(c))) continue; // uzun içerik/mix ele
      const a = c.artist.toLowerCase();
      if (favArtists.has(a)) continue;
      favArtists.add(a);
      takenCores.add(songCore(c.title, c.artist));
      recs.push({
        ...toTrack(c),
        recSource: "library",
        reason: { key: "rec.favorite", dow: curDow },
      });
      taken.add(c.id);
      favAdded++;
    }
  }

  // 3) YouTube adayları — YouTube Music RADYOSU (metin araması değil).
  //
  // NEDEN RADYO: eskiden `ytsearch:songs like {sanatçı}` yapılıyordu. YouTube o
  // sorguya VİDEO döndürüyor, şarkı değil → kuyruk röportaj, tepki videosu,
  // "5 Things You Didn't Know…", belgesel kesiti, kısa film ile doluyordu.
  // Başlık sezgisiyle bunları ayıklamak mümkün değil ("Meet Dark R&B's Newest
  // Darling" bir röportaj; hiçbir anahtar kelime yanlış-eleme yapmadan yakalamaz).
  // Radyo (RDAMVM<videoId>) YouTube Music'in kendi öneri motoru → yapısı gereği
  // yalnız şarkı. Ölçüm: seed başına ~2.9sn / 50 sonuç / 40+ farklı sanatçı.
  //
  // Radyo VİDEO ID ile beslenir (sanatçı adıyla değil) → seed'ler artık en güçlü
  // sinyalli PARÇALAR. isLikelySong yine uygulanır (radyoda da 1000'de ~5 uzun
  // içerik çıkıyor), songCore/geçmiş dışlamaları aynen geçerli.
  if (opts.useYouTube && recs.length < opts.limit) {
    // Seed parçaları: kütüphanedeki YouTube parçaları, sinyale göre sıralı
    // (parça karması + sanatçı yakınlığı).
    //
    // ⚠️ SANATÇI BAŞINA EN İYİ TEK PARÇA. Eskiden "en iyi 12 parça" alınıyordu;
    // son oylar tek sanatçıda toplanınca 12'nin çoğu O sanatçı oluyordu (ör. iki
    // seed de Cordiseps) → iki radyo da aynı tarz → "hep rap öneriyor" bug'ı.
    // Sanatçı başına tek parça = her seed FARKLI sanatçı = tarz karışımı.
    const libTracks = await db.select<
      { id: string; source_id: string; title: string; artist: string }[]
    >(`SELECT id, source_id, title, artist FROM tracks WHERE source = 'youtube'`);
    const bestPerArtist = new Map<
      string,
      { t: (typeof libTracks)[number]; score: number }
    >();
    for (const t of libTracks) {
      const score =
        (trackKarma.get(t.id) ?? 0) + (artistAffinity.get(t.artist) ?? 0);
      if (score <= 0) continue;
      const key = t.artist.toLowerCase();
      const prev = bestPerArtist.get(key);
      if (!prev || score > prev.score) bestPerArtist.set(key, { t, score });
    }
    // ⭐ AĞIRLIKLI RASTGELE ÖRNEKLEME (katı "en iyi 12" DEĞİL).
    //
    // Neden: playlist sinyali havuzu 8 → 184 sanatçıya çıkardı, ama katı
    // sıralamada oy verilmiş 8 sanatçı her zaman ilk 12'yi kapardı → havuz
    // büyümesine rağmen yine aynı tarz gelirdi. Ağırlıklı örneklemede her
    // sanatçının seçilme ŞANSI yakınlığıyla orantılı: çok sevdiklerin sık,
    // listendeki diğerleri seyrek ama DÜZENLİ olarak gelir (keşif/sömürü dengesi).
    //
    // Gumbel/exponential hilesi: key = -ln(rastgele)/ağırlık → küçükten sırala
    // = ağırlıklı, tekrarsız örnekleme.
    //
    // ⭐ MOD ÇARPANI (v1.3.0): kalıcı yakınlık "genel olarak kimi seversin"i,
    // oturum modu "BUGÜN canın ne istiyor"u söyler. Sonuna kadar dinlediğin
    // tarzlar öne çıkar, hemen geçtiklerin geriler (taban 0.35 → hiçbiri
    // tamamen ölmez, yoksa keşif kapanır). Bkz. lib/mood.ts.
    const pool = [...bestPerArtist.values()].filter(
      (x) =>
        !opts.excludeSeedArtists?.has(x.t.artist.toLowerCase()) &&
        !isBlocked(x.t.artist) // "bu sanatçıyı önerme"
    );
    const sampleWeighted = (
      items: typeof pool,
      n: number,
      weight: (x: (typeof pool)[number]) => number
    ) =>
      items
        .map((x) => ({
          t: x.t,
          key: -Math.log(Math.random() || 1e-9) / Math.max(0.02, weight(x)),
        }))
        .sort((a, b) => a.key - b.key)
        .slice(0, n)
        .map((x) => x.t);

    // ⭐ Üç katman çarpılır:
    //   score           → KALICI zevk (oy + dinleme + playlist üyeliği)
    //   moodMultiplier  → BU OTURUMDAKİ mod (lib/mood.ts)
    //   tasteBoost      → BU SAAT/GÜN bağlamı, güvene göre (lib/taste.ts)
    //   acceptanceBoost → ÖNERİNCE TUTUYOR MU (lib/acceptance.ts) — listende
    //                     olup da radyodan gelince hep geçtiğin sanatçıyı
    //                     geriletir; diğer üç katmanın göremediği tek şey bu.
    const seedWeight = (a: string) => {
      const base = moodMultiplier(a) * tasteBoost(a) * acceptanceBoost(a);
      // Tarz kilidi: kilitli sanatçı neredeyse kesin seçilsin (×8), ama diğer
      // katmanlar tamamen susturulmasın — çeşitlilik bir miktar kalsın.
      return opts.lockedSeedArtist &&
        a.toLowerCase() === opts.lockedSeedArtist.toLowerCase()
        ? base * 8
        : base;
    };

    const moodSeeds = sampleWeighted(pool, 12, (x) => x.score * seedWeight(x.t.artist));

    // Zaten sevilen sanatçılar — yeni sanatçı keşiflerini işaretlemek için.
    const knownArtists = new Set(
      [...artistAffinity.keys()].map((a) => a.toLowerCase())
    );

    const needed = opts.limit - recs.length;

    // ── Tohumları topla ────────────────────────────────────────────────────
    // ⚠️ Eskiden yalnız 3 radyo açılıyordu → bir partide 3 tarz → kullanıcının
    // "hep aynı 3-4 sanatçı" şikâyeti. Artık 6 radyo (2 dalga × 3 eşzamanlı):
    // yt-dlp throttle sınırı eşzamanlılıkta, TOPLAM sayıda değil.
    type RadioSeed = { sourceId: string; artist: string; probe?: boolean };
    const seeds: RadioSeed[] = [];
    const seenSeedArtist = new Set<string>();
    const pushSeed = (s: RadioSeed) => {
      const k = s.artist.toLowerCase();
      if (!s.sourceId || seenSeedArtist.has(k)) return;
      seenSeedArtist.add(k);
      seeds.push(s);
    };

    const filterIds = opts.filters ?? [];
    let genrePool: Track[] = [];
    if (filterIds.length > 0) {
      // FİLTRELİ MOD — kullanıcının istediği karışım:
      //  (a) hiç bilmediği sanatçılar → küratörlü tür havuzundan DOĞRUDAN,
      //  (b) tanıdık sanatçının bilmediği şarkısı → havuzla KESİŞEN kendi
      //      sanatçılarının radyosundan.
      genrePool = await genrePoolFor(filterIds);
      const poolArtists = new Set(
        genrePool.map((t) => effectiveArtist(t).toLowerCase())
      );
      // Kullanıcının BU TÜRDEKİ sanatçıları (tür alanı olmadığı için kesişimle).
      const mineInGenre = pool.filter((x) =>
        poolArtists.has(x.t.artist.toLowerCase())
      );
      // ⚠️ SADECE 1 kişisel radyo. 2 iken (ölçüldü) rock filtresinde kuyruğun
      // yarısı tek sanatçının (Journey) radyosundan geliyordu — kullanıcı
      // "daha az journey, daha çok filtreden gelen" dedi. Havuz aşağıda 3
      // parçaya bölünüyor → oran ~%75 filtre / %25 kişisel.
      for (const t of sampleWeighted(
        mineInGenre,
        1,
        (x) => x.score * seedWeight(x.t.artist)
      )) {
        pushSeed({ sourceId: t.source_id, artist: t.artist });
      }
    } else {
      // FİLTRESİZ: saf öğrenme + mod.
      for (const t of moodSeeds.slice(0, 5)) {
        pushSeed({ sourceId: t.source_id, artist: t.artist });
      }
      // ⭐ PROB: modu ölçülmemiş bir tarzdan tohum ekle → "modun değişti mi?"
      // testi. Bundan gelen parçalar isProbe işaretlenir; kullanıcı bunları
      // dinlerse mod o yöne kayar (lib/mood.ts).
      const probe = sampleWeighted(
        pool.filter(
          (x) =>
            isProbeCandidate(x.t.artist) &&
            !seenSeedArtist.has(x.t.artist.toLowerCase())
        ),
        1,
        (x) => x.score
      )[0];
      if (probe) {
        pushSeed({ sourceId: probe.source_id, artist: probe.artist, probe: true });
      }
    }

    const radioCount = Math.min(seeds.length, needed <= 6 ? 3 : 6);
    const chosen = seeds.slice(0, radioCount);

    // Radyoları 3'erli DALGALAR hâlinde çek (aynı anda en fazla 3 yt-dlp →
    // throttle güvenli; toplamda 6 tohum → 6 farklı tarz).
    const radios: { seed: RadioSeed; results: Track[] }[] = [];
    for (let start = 0; start < chosen.length; start += 3) {
      const wave = await Promise.all(
        chosen.slice(start, start + 3).map(async (seed) => {
          try {
            const results = await invoke<Track[]>("music_radio", {
              videoId: seed.sourceId,
              limit: 50,
            });
            // Karıştır — ama SAF rastgele değil: kullanıcının yakınlık duyduğu
            // sanatçılar hafifçe öne çekilir (Gumbel: key = -ln(rnd)/ağırlık).
            // Tür bozulmaz (parçalar zaten o radyodan), yalnız tanıdık olanlar
            // biraz öne gelir → istenen "karışık" tat.
            const weighted = results
              .map((r) => ({
                r,
                key:
                  -Math.log(Math.random() || 1e-9) /
                  (1 + Math.max(0, artistAffinity.get(r.artist) ?? 0)),
              }))
              .sort((a, b) => a.key - b.key)
              .map((x) => x.r);
            return { seed, results: weighted };
          } catch (e) {
            console.error("[resonance] radyo alınamadı:", e);
            return { seed, results: [] as Track[] };
          }
        })
      );
      radios.push(...wave);
    }

    // ⭐ Tür havuzunu İKİ sahte radyo olarak ekle. Round-robin her kaynaktan
    // sırayla parça aldığı için bu, partinin ~yarısının küratörlü havuzdan
    // (yeni sanatçılar), ~yarısının kullanıcının kendi tür sanatçılarının
    // radyosundan (tanıdık sanatçı, bilinmeyen şarkı) gelmesini sağlar.
    if (genrePool.length > 0) {
      // Havuzu ÜÇ sahte radyoya böl (kişisel radyo 1 tane) → round-robin'de
      // her 4 parçanın 3'ü filtreden gelir.
      const n = Math.ceil(genrePool.length / 3);
      const label = filterIds.join(" · ");
      radios.unshift(
        { seed: { sourceId: "", artist: label }, results: genrePool.slice(0, n) },
        { seed: { sourceId: "", artist: label }, results: genrePool.slice(n, n * 2) },
        { seed: { sourceId: "", artist: label }, results: genrePool.slice(n * 2) }
      );
    }

    // ⚠️ ROUND-ROBIN: her radyodan SIRAYLA birer parça al.
    // Eskiden radyolar sırayla tüketiliyordu → ilk radyo 20 kontenjanın hepsini
    // doldurup ikinciye hiç sıra gelmiyordu (tek tarz). Round-robin tarzları
    // gerçekten karıştırır.
    //
    // Sanatçı sınırı (2): radyonun BAŞI seed sanatçının kendi şarkılarıyla dolu
    // (Tarkan radyosunda ilk 3 parça Tarkan) → sınır olmadan kuyruk ona döner.
    const radioArtistCount = new Map<string, number>();
    const cursors = radios.map(() => 0);
    let exhausted = false;
    while (recs.length < opts.limit && !exhausted) {
      exhausted = true;
      for (let ri = 0; ri < radios.length; ri++) {
        if (recs.length >= opts.limit) break;
        const { seed, results } = radios[ri];
        // Bu radyoda uygun bir sonraki parçayı bul.
        while (cursors[ri] < results.length) {
          const r = results[cursors[ri]++];
          if (taken.has(r.id)) continue;
          // Yeni keşifler 45-gün tekrar engeline TABİ (favoriler değil, bkz. yukarı).
          if (recentlyRecommended.has(r.id)) continue;
          if (r.sourceId === seed.sourceId) continue; // seed'in kendisi
          if (playlistKeys.has(normKey(r.title, r.artist))) continue;
          if (takenCores.has(songCore(r.title, r.artist))) continue; // versiyon kopyası
          if (!isLikelySong(r)) continue; // radyoda da nadiren uzun içerik çıkar
          // Engellenen sanatçı: tohum olmasa bile radyodan gelebilir → ele.
          if (isBlocked(effectiveArtist(r))) continue;
          // Parti başına SANATÇI BAŞINA 1 PARÇA (eskiden 2'ydi; kullanıcı
          // "2 sanatçıdan 4 şarkı geldi" dedi). effectiveArtist: YT Music liste
          // girdilerinde artist alanı KANAL adıdır, gerçek sanatçı başlıkta.
          const a = effectiveArtist(r).toLowerCase();
          if ((radioArtistCount.get(a) ?? 0) >= 1) continue;
          radioArtistCount.set(a, (radioArtistCount.get(a) ?? 0) + 1);
          const newArtist = !knownArtists.has(a);
          recs.push({
            ...r,
            recSource: "youtube",
            seedArtist: seed.artist,
            isProbe: seed.probe,
            reason: newArtist
              ? { key: "rec.newDiscovery", seed: seed.artist, artist: r.artist }
              : { key: "rec.contextual", seed: seed.artist, dow: curDow },
          });
          taken.add(r.id);
          takenCores.add(songCore(r.title, r.artist));
          exhausted = false; // bu turda en az bir parça eklendi
          break; // sıra diğer radyoya
        }
      }
    }

    // Soğuk başlangıç YEDEĞİ: hiç sinyal yok (yeni kullanıcı) ya da radyolar
    // boş döndü → eski metin-araması yolu. Kalitesi düşük ama hiç yoktan iyi;
    // birkaç oy/dinleme sonrası radyo devreye girer ve burası bir daha çalışmaz.
    if (recs.length < opts.limit) {
      await addSearchFallback(db, opts, recs, {
        taken,
        takenCores,
        playlistKeys,
        recentlyRecommended,
      });
    }
  }

  return recs.slice(0, opts.limit);
}

/**
 * Filtrelerden (tür / ruh hali) radyo TOHUMU üretir.
 *
 * Akış: filtre sorgusuyla YouTube'da ara → `isLikelySong`ten geçen ilk birkaç
 * sonuçtan rastgele biri tohum olur → asıl parçalar o tohumun RADYOSUNDAN gelir.
 *
 * ⚠️ Arama sonuçları DOĞRUDAN öneri olarak kullanılmaz (CLAUDE.md: metin araması
 * röportaj/tepki videosu döndürür). Yalnız tohum seçilir ve tohum da süre +
 * başlık filtresinden geçer. Radyo yapısı gereği şarkı döndürdüğü için tarz
 * tutarlılığı oradan gelir.
 */
/**
 * Filtre(ler) için TÜR HAVUZU: YouTube Music'in küratörlü tür/ruh hali
 * listelerinden gerçek şarkılar (bkz. ytdlp::music_genre_pool).
 *
 * Bu havuz iki işe yarar:
 *  1. Doğrudan öneri adayı → kullanıcının HİÇ BİLMEDİĞİ sanatçılar.
 *  2. ⭐ TÜR ETİKETİ KAYNAĞI: veritabanında tür alanı yok. Kullanıcının hangi
 *     sanatçısının "rock" olduğunu bilmiyoruz — ama havuzdaki sanatçılarla
 *     KESİŞTİRİNCE öğreniyoruz. O kesişim = "kullanıcının bu türdeki
 *     sanatçıları" → onların radyosu, tanıdık sanatçının BİLİNMEYEN şarkısını
 *     getirir. Kullanıcının istediği karışım tam olarak budur.
 */
async function genrePoolFor(filterIds: string[]): Promise<Track[]> {
  // Seçilen HER tür temsil edilsin (queriesFor tür başına 1 sorgu üretir).
  const queries = queriesFor(filterIds).slice(0, 3);
  if (queries.length === 0) return [];
  const out: Track[] = [];
  const seen = new Set<string>();
  const waves = await Promise.all(
    queries.map(async (q) => {
      try {
        return await invoke<Track[]>("music_genre_pool", { query: q, limit: 60 });
      } catch (e) {
        console.error("[resonance] tür havuzu alınamadı:", q, e);
        return [] as Track[];
      }
    })
  );
  for (const w of waves) {
    for (const t of w) {
      if (!t.sourceId || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

/**
 * Gerçek sanatçı adı. YouTube Music liste girdilerinde `artist` alanı çoğu zaman
 * KANAL adıdır ("MuzikPlay", "netd müzik") — sanatçı başlıkta gizlidir
 * ("Can Koç - Gökyüzünü Tutamam"). Çeşitlilik sayacı ve kullanıcı sanatçılarıyla
 * kesişim bu ada göre yapılmalı, yoksa tek kanal tüm partiyi doldurur.
 */
function effectiveArtist(t: Track): string {
  const dash = t.title.split(/\s[-–—]\s/);
  if (dash.length > 1 && dash[0].trim().length >= 2) return dash[0].trim();
  return t.artist;
}

// Metin-araması yolu — YALNIZCA soğuk başlangıç yedeği (bkz. yukarıdaki not).
async function addSearchFallback(
  db: Awaited<ReturnType<typeof getDb>>,
  opts: RecommendOpts,
  recs: Recommendation[],
  ctx: {
    taken: Set<string>;
    takenCores: Set<string>;
    playlistKeys: Set<string>;
    recentlyRecommended: Set<string>;
  }
): Promise<void> {
  const { taken, takenCores, playlistKeys, recentlyRecommended } = ctx;

  // Seed: listenin kendi sanatçıları (sinyal yok, elde başka bir şey yok).
  const plArtists = await db.select<{ artist: string; c: number }[]>(
    `SELECT t.artist, COUNT(*) AS c
     FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = $1 AND t.artist <> '' AND pt.deleted = 0
     GROUP BY t.artist ORDER BY c DESC LIMIT 8`,
    [opts.playlistId]
  );
  const seedPool = plArtists
    .map((r) => r.artist)
    .sort(() => Math.random() - 0.5);
  if (seedPool.length === 0) return;

  const needed = opts.limit - recs.length;
  const seedCount = Math.min(seedPool.length, Math.max(2, Math.ceil(needed / 2)));
  const seeds = seedPool.slice(0, seedCount);
  const perSeed = Math.max(2, Math.min(4, Math.ceil(needed / Math.max(1, seedCount))));

  // Aramaları 3'erli gruplar hâlinde PARALEL çalıştır — tek tek beklenince
  // (seed başına ~1-3 sn) çok yavaş. 3'ten fazla eşzamanlı yt-dlp throttle riski.
  const searches: { seed: string; results: Track[] }[] = [];
  for (let start = 0; start < seeds.length; start += 3) {
    const out = await Promise.all(
      seeds.slice(start, start + 3).map(async (seed) => {
        try {
          const results = await invoke<Track[]>("search_youtube", {
            query: `${seed} songs`,
            limit: 15,
            cookiesBrowser: useSettingsStore.getState().cookiesBrowser,
          });
          return { seed, results };
        } catch (e) {
          console.error("[resonance] yedek arama başarısız:", e);
          return { seed, results: [] as Track[] };
        }
      })
    );
    searches.push(...out);
  }

  for (const { seed, results } of searches) {
    if (recs.length >= opts.limit) break;
    let added = 0;
    for (const r of results) {
      if (recs.length >= opts.limit) break;
      if (taken.has(r.id) || added >= perSeed) continue;
      if (recentlyRecommended.has(r.id)) continue;
      if (playlistKeys.has(normKey(r.title, r.artist))) continue;
      if (takenCores.has(songCore(r.title, r.artist))) continue;
      if (!isLikelySong(r)) continue;
      recs.push({
        ...r,
        recSource: "youtube",
        reason: { key: "rec.fromPlaylist", seed },
      });
      taken.add(r.id);
      takenCores.add(songCore(r.title, r.artist));
      added++;
    }
  }
}
