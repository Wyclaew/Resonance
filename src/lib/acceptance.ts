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
