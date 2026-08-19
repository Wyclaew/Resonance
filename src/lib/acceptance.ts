import { getDb, isTauri } from "./db";

// ═══════════════════════════════════════════════════════════════════════════
// ÖNERİ KABUL ORANI — "önerdiklerim tutuyor mu?"
//
// EKSİK OLAN GERİ BESLEME BUYDU: uygulama neyi ÖNERDİĞİNİ
// (`recommendation_history`) ve neyi DİNLEDİĞİNİ (`play_history`) ayrı ayrı
// biliyordu ama ikisini HİÇ KARŞILAŞTIRMIYORDU. Yani "bu sanatçıyı önerince
// gerçekten dinleniyor mu, yoksa hep geçiliyor mu?" sorusunun cevabı hiçbir
// yerde yoktu.
//
// NEDEN MEVCUT SİNYALLERDEN FARKLI: `artistAffinity` "bu sanatçıyı seviyorum"
// der ve playlist üyeliği onu güçlü besler (ağırlık 0.6, uzun yarı ömür).
// Ama listende olan bir sanatçının RADYODAN gelen şarkılarını sürekli
// geçiyor olabilirsin — eski model bunu göremez ve o sanatçıyı tohum seçmeye
// devam ederdi. Kabul oranı tam da bunu yakalar:
//   "önerdiğimde ne oluyor" ≠ "genel olarak seviyor muyum"
//
// KAYNAK: iki tablo da senkronlanıyor → öğrenilen kabul oranı cihazlar arası
// ORTAK ve zamanla birikiyor (oturum modundan farkı bu: kalıcı).
//
// KENDİNİ DÜZELTİR: az veri varsa çarpan 1'e (etkisiz) yaklaşır; öneri sayısı
// arttıkça etki büyür. Yani yanlış bir erken yargı kendiliğinden düzelir.
// ═══════════════════════════════════════════════════════════════════════════

type Stat = { shown: number; score: number };

const stats = new Map<string, Stat>();
let builtAt = 0;
const REBUILD_MS = 10 * 60 * 1000;
// Bu sayının altında öneri görmüş sanatçıda etki kısılır (birkaç örnekten
// "bu tutmuyor" sonucu çıkarmak gürültüdür).
const MIN_SHOWN = 4;
const WINDOW_DAYS = 120;

/** Dinlenme oranından kabul puanı (mood.ts/taste.ts ile aynı eşikler). */
function acceptScore(ratio: number): number {
  if (ratio >= 0.7) return 1; // sonuna kadar → öneri tuttu
  if (ratio >= 0.4) return 0.35;
  if (ratio >= 0.15) return -0.2;
  return -0.6; // hiç dinlenmedi / hemen geçildi → öneri ıskaladı
}

export async function buildAcceptance(force = false): Promise<void> {
  if (!isTauri()) return;
  if (!force && Date.now() - builtAt < REBUILD_MS && stats.size > 0) return;
  try {
    const db = await getDb();
    const since = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;

    // Önerilen her parça için: önerildikten SONRA ne kadar dinlendi?
    // LEFT JOIN → hiç dinlenmeyenler de gelir (ms_played NULL → oran 0), ki
    // asıl öğrenmek istediğimiz sinyal zaten bu.
    const rows = await db.select<
      { artist: string; duration_ms: number; ms: number | null }[]
    >(
      `SELECT t.artist,
              t.duration_ms,
              (SELECT MAX(h.ms_played) FROM play_history h
                WHERE h.track_id = r.track_id
                  AND h.played_at >= r.recommended_at) AS ms
         FROM recommendation_history r
         JOIN tracks t ON t.id = r.track_id
        WHERE r.recommended_at >= $1 AND t.artist <> '' AND t.duration_ms > 0`,
      [since]
    );

    const next = new Map<string, Stat>();
    for (const r of rows) {
      const ratio = Math.max(0, Math.min(1, (r.ms ?? 0) / r.duration_ms));
      const key = r.artist.toLowerCase();
      const s = next.get(key) ?? { shown: 0, score: 0 };
      s.shown += 1;
      s.score += acceptScore(ratio);
      next.set(key, s);
    }
    stats.clear();
    for (const [k, v] of next) stats.set(k, v);
    builtAt = Date.now();
  } catch (e) {
    console.error("[resonance] kabul oranı hesaplanamadı:", e);
  }
}

/**
 * Tohum örneklemesi için çarpan.
 * Önerileri tutan sanatçılar öne çıkar, ıskalayanlar geriler.
 * Taban 0.4 — hiçbir sanatçı tamamen ölmez (zevk değişir, ikinci şans kalsın).
 */
export function acceptanceBoost(artist: string): number {
  const s = stats.get(artist.toLowerCase());
  if (!s || s.shown === 0) return 1; // veri yok → etkisiz
  const avg = s.score / s.shown; // −0.6 … 1
  // Güven: yeterli örnek yoksa etkiyi kıs.
  const confidence = Math.min(1, s.shown / MIN_SHOWN);
  return Math.max(0.4, 1 + avg * 0.7 * confidence);
}

/** Teşhis/UI: en çok ıskalayan sanatçılar (öneri kalitesini görmek için). */
export function acceptanceSummary(n = 5): { artist: string; shown: number; avg: number }[] {
  return [...stats.entries()]
    .filter(([, s]) => s.shown >= MIN_SHOWN)
    .map(([artist, s]) => ({ artist, shown: s.shown, avg: s.score / s.shown }))
    .sort((a, b) => a.avg - b.avg)
    .slice(0, n);
}

/** Sanatçı bazında kabul oranı (0..1) — UI rozeti. Veri yoksa null. */
export function acceptanceRate(artist: string): number | null {
  const s = stats.get(artist.toLowerCase());
  if (!s || s.shown === 0) return null;
  // score −0.6…1 → 0..1 aralığına taşı (okunur yüzde).
  return Math.max(0, Math.min(1, (s.score / s.shown + 0.6) / 1.6));
}

export function acceptanceShown(artist: string): number {
  return stats.get(artist.toLowerCase())?.shown ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// ÖNERİ KALİTESİ RAPORU (v1.8.0) — "model işe yarıyor mu?"
//
// NEDEN AYRI: yukarıdaki `buildAcceptance` öneri hesabının KRİTİK YOLUNDA
// çalışır (her parti kurulumunda) → orada ekstra iş yapılmamalı. Bu rapor
// yalnızca kullanıcı Zevk Profili sayfasını açınca hesaplanır.
//
// ⚠️ DÖRT ÖĞRENME KATMANI (yakınlık, oturum modu, zaman bağlamı, kabul oranı)
// vardı ama HİÇBİRİNİN İŞE YARAYIP YARAMADIĞI ÖLÇÜLMÜYORDU. Yeni katman
// eklemeden önce eksik olan buydu: haftalık kabul oranı, modelin gerçek
// karnesidir. Düşüyorsa yeni bir katman değil, DÜZELTME gerekir.
//
// "Kabul edildi" = önerildikten sonra en az %40'ı dinlendi. Eşik mood.ts /
// taste.ts / acceptScore ile aynı ailedendir (0.4 = "yarıya yakın dinledi").
// ═══════════════════════════════════════════════════════════════════════════

const ACCEPT_RATIO = 0.4;

export type AcceptanceReport = {
  /** Haftalık seri (eskiden yeniye), UI çubuk grafiği. */
  weeks: { start: number; shown: number; accepted: number }[];
  total: { shown: number; accepted: number };
  /** Öneri anında kullanıcının HİÇ dinlememiş olduğu sanatçılar → keşif karnesi. */
  discovery: { shown: number; accepted: number };
  best: { artist: string; shown: number; rate: number }[];
  worst: { artist: string; shown: number; rate: number }[];
};

const EMPTY_REPORT: AcceptanceReport = {
  weeks: [],
  total: { shown: 0, accepted: 0 },
  discovery: { shown: 0, accepted: 0 },
  best: [],
  worst: [],
};

export async function acceptanceReport(days = 84): Promise<AcceptanceReport> {
  if (!isTauri()) return EMPTY_REPORT;
  try {
    const db = await getDb();
    const since = Date.now() - days * 24 * 3600 * 1000;

    const recs = await db.select<
      { track_id: string; recommended_at: number; artist: string; duration_ms: number }[]
    >(
      `SELECT r.track_id, r.recommended_at, t.artist, t.duration_ms
         FROM recommendation_history r JOIN tracks t ON t.id = r.track_id
        WHERE r.recommended_at >= $1 AND t.duration_ms > 0`,
      [since]
    );
    if (recs.length === 0) return EMPTY_REPORT;

    // Tüm dinlemeler tek sorguda; eşleştirme JS'te yapılır.
    // ⚠️ Korelasyonlu alt sorgu (öneri başına play_history taraması) DENENMEDİ
    // bilerek: binlerce öneri × binlerce dinleme = O(n·m). İki düz sorgu + Map
    // ile aynı sonuç, tek geçişte.
    const plays = await db.select<
      { track_id: string; played_at: number; ms_played: number; artist: string }[]
    >(
      `SELECT h.track_id, h.played_at, h.ms_played, t.artist
         FROM play_history h JOIN tracks t ON t.id = h.track_id`
    );

    // parça → (zaman, süre) listesi ; sanatçı → ilk dinleme zamanı
    const byTrack = new Map<string, { at: number; ms: number }[]>();
    const firstPlayOfArtist = new Map<string, number>();
    for (const p of plays) {
      const arr = byTrack.get(p.track_id) ?? [];
      arr.push({ at: p.played_at, ms: p.ms_played });
      byTrack.set(p.track_id, arr);
      const a = p.artist.toLowerCase();
      const prev = firstPlayOfArtist.get(a);
      if (prev === undefined || p.played_at < prev) firstPlayOfArtist.set(a, p.played_at);
    }

    const WEEK = 7 * 24 * 3600 * 1000;
    const weekMap = new Map<number, { shown: number; accepted: number }>();
    const total = { shown: 0, accepted: 0 };
    const discovery = { shown: 0, accepted: 0 };
    const perArtist = new Map<string, { shown: number; accepted: number }>();

    for (const r of recs) {
      // Önerildikten SONRAKİ en uzun dinleme.
      let best = 0;
      for (const p of byTrack.get(r.track_id) ?? []) {
        if (p.at >= r.recommended_at && p.ms > best) best = p.ms;
      }
      const ok = best / r.duration_ms >= ACCEPT_RATIO;

      const wk = Math.floor(r.recommended_at / WEEK) * WEEK;
      const w = weekMap.get(wk) ?? { shown: 0, accepted: 0 };
      w.shown += 1;
      if (ok) w.accepted += 1;
      weekMap.set(wk, w);

      total.shown += 1;
      if (ok) total.accepted += 1;

      const a = r.artist.toLowerCase();
      // "Yeni sanatçı": öneri anında bu sanatçıdan hiç dinleme yoktu.
      const first = firstPlayOfArtist.get(a);
      if (first === undefined || first >= r.recommended_at) {
        discovery.shown += 1;
        if (ok) discovery.accepted += 1;
      }

      if (a) {
        const s = perArtist.get(a) ?? { shown: 0, accepted: 0 };
        s.shown += 1;
        if (ok) s.accepted += 1;
        perArtist.set(a, s);
      }
    }

    const weeks = [...weekMap.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([start, v]) => ({ start, ...v }));

    const ranked = [...perArtist.entries()]
      .filter(([, s]) => s.shown >= MIN_SHOWN)
      .map(([artist, s]) => ({ artist, shown: s.shown, rate: s.accepted / s.shown }))
      .sort((a, b) => b.rate - a.rate || b.shown - a.shown);

    return {
      weeks,
      total,
      discovery,
      best: ranked.slice(0, 5),
      worst: ranked.slice(-5).reverse(),
    };
  } catch (e) {
    console.error("[resonance] öneri kalitesi raporu hesaplanamadı:", e);
    return EMPTY_REPORT;
  }
}
