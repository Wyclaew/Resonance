import { getDb, isTauri } from "./db";

// ═══════════════════════════════════════════════════════════════════════════
// ZAMAN-BAĞLAMLI ZEVK PROFİLİ — "bu saatte ne dinlemek istersin?"
//
// Kullanıcının isteği: "hangi saat ne dinlediğime göre ruh hali tahmini
// yapabilir, eğer tutmazsa bunu da öğrenme algoritmasına katsın".
//
// ⭐ NEDEN YENİ TABLO YOK: profil `play_history` + `tracks`'ten TÜRETİLİR.
// Bu iki tablo zaten buluta senkronlanıyor (docs/SYNC.md), dolayısıyla
// öğrenilen zevk cihazlar arasında OTOMATİK ortaktır. Ayrı bir profil tablosu
// tutulsaydı, sayaç türü veriyi last-write-wins ile birleştirmek zorunda
// kalırdık ve iki cihazın öğrendiği birbirini EZERDİ.
//
// ⭐ KOVA (bucket) MODELİ: recommender'daki mevcut `contextWeight` saat farkına
// üstel bir benzerlik uygular (sürekli). Bu modül ondan FARKLI ve tamamlayıcı:
// ayrık kovalar (hafta içi/sonu × günün 5 dilimi) tutar, böylece "hafta içi
// sabah" ile "cumartesi gece" gerçekten ayrı profiller olur.
//
// ⭐ KENDİNİ DÜZELTEN GÜVEN (asıl istenen "tutmazsa öğrensin"):
// Tahminin ne kadar güçlü uygulanacağı, o kovadaki dinlemenin NE KADAR
// ÖNGÖRÜLEBİLİR olduğuna bağlıdır. Kullanıcı o kovada hep aynı birkaç tarzı
// dinliyorsa dağılım DERLİ TOPLUdur → yüksek güven → tahmin güçlü uygulanır.
// Her seferinde başka şey dinliyorsa dağılım DAĞINIKtır → düşük güven →
// tahmin neredeyse hiç uygulanmaz. Yani tahmin "tutmuyorsa" etkisi kendiliğinden
// söner; ayrıca bir "isabet/ıska" defteri tutmaya gerek kalmaz.
// ═══════════════════════════════════════════════════════════════════════════

export type Bucket = string; // "wd-morning" | "we-night" …

/** Günün dilimi — uyku/iş/akşam ritmine göre. */
function dayPart(hour: number): string {
  if (hour < 5) return "lateNight";
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

export function bucketOf(d: Date = new Date()): Bucket {
  const dow = d.getDay();
  const weekend = dow === 0 || dow === 6;
  return `${weekend ? "we" : "wd"}-${dayPart(d.getHours())}`;
}

function bucketFromRow(hour: number, dow: number): Bucket {
  const weekend = dow === 0 || dow === 6;
  return `${weekend ? "we" : "wd"}-${dayPart(hour)}`;
}

/** Dinlenme oranından zevk puanı (mood.ts ile aynı eşikler — tutarlılık). */
function ratioScore(ratio: number): number {
  if (ratio >= 0.7) return 1;
  if (ratio >= 0.4) return 0.35;
  if (ratio >= 0.15) return -0.15;
  return -0.5;
}

const HALF_LIFE_DAYS = 30;
function decay(ageMs: number): number {
  return Math.pow(0.5, ageMs / (HALF_LIFE_DAYS * 24 * 3600 * 1000));
}

type BucketProfile = {
  /** sanatçı → ham puan (pozitif = seviyor) */
  scores: Map<string, number>;
  /** en yüksek pozitif puan (normalizasyon için) */
  max: number;
  /** 0..1 — bu kovadaki tahminlere ne kadar güvenilir */
  confidence: number;
  plays: number;
};

const EMPTY: BucketProfile = {
  scores: new Map(),
  max: 0,
  confidence: 0,
  plays: 0,
};

let profiles = new Map<Bucket, BucketProfile>();
let builtAt = 0;
const REBUILD_MS = 10 * 60 * 1000; // 10 dk

/**
 * Dağılımın DERLİ TOPLULUĞU (0..1). Entropi tabanlı:
 * tek bir tarza yığılmışsa 1'e, her şeye eşit dağılmışsa 0'a yakın.
 */
function concentration(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || weights.length < 2) return 0;
  let h = 0;
  for (const w of weights) {
    const p = w / total;
    if (p > 0) h -= p * Math.log(p);
  }
  const hMax = Math.log(weights.length);
  if (hMax <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - h / hMax));
}

/** Profili (gerekiyorsa) yeniden kurar. Ucuz: tek sorgu + bellek içi toplama. */
export async function buildTasteProfile(force = false): Promise<void> {
  if (!isTauri()) return;
  if (!force && Date.now() - builtAt < REBUILD_MS && profiles.size > 0) return;
  try {
    const db = await getDb();
    const rows = await db.select<
      {
        artist: string;
        ms_played: number;
        duration_ms: number;
        played_at: number;
        hour: number;
        dow: number;
      }[]
    >(
      `SELECT t.artist, h.ms_played, t.duration_ms, h.played_at, h.hour, h.dow
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE t.artist <> '' AND t.duration_ms > 0`
    );

    const next = new Map<Bucket, BucketProfile>();
    const now = Date.now();
    for (const r of rows) {
      const b = bucketFromRow(r.hour, r.dow);
      const p =
        next.get(b) ??
        ({ scores: new Map(), max: 0, confidence: 0, plays: 0 } as BucketProfile);
      const ratio = Math.max(0, Math.min(1, r.ms_played / r.duration_ms));
      const w = ratioScore(ratio) * decay(now - r.played_at);
      const key = r.artist.toLowerCase();
      p.scores.set(key, (p.scores.get(key) ?? 0) + w);
      p.plays += 1;
      next.set(b, p);
    }

    for (const p of next.values()) {
      const positives = [...p.scores.values()].filter((v) => v > 0);
      p.max = positives.length ? Math.max(...positives) : 0;
      // Güven = derli toplulık × yeterli veri. 20 dinleme altında temkinli
      // davran (birkaç örnekten "zevk" çıkarmak gürültüdür).
      p.confidence =
        concentration(positives) * Math.min(1, p.plays / 20);
    }
    profiles = next;
    builtAt = Date.now();
  } catch (e) {
    console.error("[resonance] zevk profili kurulamadı:", e);
  }
}

function current(): BucketProfile {
  return profiles.get(bucketOf()) ?? EMPTY;
}

/**
 * Bu sanatçı ŞU ANKİ zaman bağlamına ne kadar uyuyor?
 * Döndürülen çarpan seed örneklemesinde yakınlık puanıyla ÇARPILIR.
 *
 * Güven düşükse 1'e (etkisiz) yaklaşır → tahmin tutmuyorsa kendiliğinden susar.
 */
export function tasteBoost(artist: string): number {
  const p = current();
  if (p.confidence <= 0 || p.max <= 0) return 1;
  const raw = p.scores.get(artist.toLowerCase()) ?? 0;
  const norm = Math.max(-1, Math.min(1, raw / p.max)); // −1..1
  // Güvenle ölçeklenmiş etki: en fazla ×1.8, en az ×0.45.
  return 1 + p.confidence * norm * 0.8;
}

/** Şu anki kova için tahmin edilen tarzlar (UI'da göstermek için). */
export function predictedStyles(n = 3): string[] {
  const p = current();
  if (p.confidence < 0.15) return []; // güven yoksa tahmin gösterme
  return [...p.scores.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

/** Şu anki bağlamın güveni (0..1) — UI "ne kadar eminim"i gösterir. */
export function currentConfidence(): number {
  return current().confidence;
}

export function currentBucketPlays(): number {
  return current().plays;
}
