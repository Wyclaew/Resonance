import type { Track } from "../types";
import { getDb, isTauri } from "./db";
import { isBlocked } from "./blocked";

// ═══════════════════════════════════════════════════════════════════════════
// SANATÇI KOMŞULUK GRAFİĞİ — "X radyosunda Y çıkıyor"
//
// ⚠️ ASIL SORUN: tohum havuzu, kullanıcının SİNYALİ OLAN sanatçılarıyla
// sınırlıydı (`tracks` tablosunda parçası olan + puanı > 0). Yani model ancak
// zaten tanıdığı sanatçıların radyosunu açabiliyordu; havuz dışına çıkmanın
// tek yolu radyonun kendi getirdiği parçalardı.
//
// ⭐ ELDEKİ BEDAVA VERİ: her radyo çağrısı 50 sonuç döndürüyor, bunların
// yalnızca 3-4'ü kuyruğa giriyor, GERİ KALANI ÇÖPE GİDİYORDU. Oysa "A'nın
// radyosunda B çıktı" bilgisi bir benzerlik kenarıdır — YouTube Music'in
// öneri motorunun bildiğini bize sızdırır. Biriktirince kullanıcının hiç
// dinlemediği sanatçılar da tohum olabilir.
//
// ⭐ `sample_id` NEDEN ŞART: radyo VİDEO KİMLİĞİ ile açılır, sanatçı adıyla
// değil. Komşu sanatçının `tracks` tablosunda bir parçası yoksa (ki tanım
// gereği yok — hiç dinlenmemiş) elimizde açılacak video olmazdı. Bu yüzden
// kenarla birlikte o sanatçıdan görülmüş BİR video kimliği saklanır.
//
// ⛔ SENKRONLANMAZ (bilerek): bu bir SAYAÇ. Senkron last-write-wins çalışır →
// iki cihazın saydığı birbirini EZER ve toplam kaybolur (taste.ts'in kendi
// tablosunu tutmama gerekçesiyle aynı). Veri zaten bedava yeniden üretiliyor:
// her cihaz kendi grafiğini birkaç gün içinde kurar.
// ═══════════════════════════════════════════════════════════════════════════

type Edge = { neighbor: string; weight: number; sampleId: string };

let graph = new Map<string, Edge[]>();
let loaded = false;

/** Bir tohumdan tutulan en fazla komşu sayısı (okuma + budama sınırı). */
const MAX_EDGES_PER_SEED = 60;
/** Komşunun tohum olabilmesi için gereken en az birliktelik. */
const MIN_EDGE_WEIGHT = 2;

/**
 * Gerçek sanatçı adı. YT Music liste girdilerinde `artist` alanı KANAL adıdır
 * ("MuzikPlay"), gerçek sanatçı başlıkta gizlidir ("Can Koç - …").
 * recommender.ts'teki eşi ile aynı mantık — grafik de aynı adı görmeli, yoksa
 * kenarlar kanal adlarına bağlanır ve grafik işe yaramaz.
 */
function effectiveArtist(t: Track): string {
  const dash = t.title.split(/\s[-–—]\s/);
  if (dash.length > 1 && dash[0].trim().length >= 2) return dash[0].trim();
  return t.artist;
}

export async function loadGraph(force = false): Promise<void> {
  if (!isTauri()) return;
  if (loaded && !force) return;
  try {
    const db = await getDb();
    const rows = await db.select<
      { seed: string; neighbor: string; weight: number; sample_id: string | null }[]
    >(
      `SELECT seed, neighbor, weight, sample_id FROM artist_edges
        WHERE weight >= $1`,
      [MIN_EDGE_WEIGHT]
    );
    const next = new Map<string, Edge[]>();
    for (const r of rows) {
      if (!r.sample_id) continue;
      const arr = next.get(r.seed) ?? [];
      arr.push({ neighbor: r.neighbor, weight: r.weight, sampleId: r.sample_id });
      next.set(r.seed, arr);
    }
    for (const arr of next.values()) {
      arr.sort((a, b) => b.weight - a.weight);
      if (arr.length > MAX_EDGES_PER_SEED) arr.length = MAX_EDGES_PER_SEED;
    }
    graph = next;
    loaded = true;
  } catch (e) {
    console.error("[resonance] komşuluk grafiği okunamadı:", e);
  }
}

/**
 * Bir radyonun sonuçlarını grafiğe işle. Kuyruğa girmeyen sonuçlar da sayılır —
 * asıl değer zaten onlarda.
 */
export async function noteRadioResults(
  seedArtist: string,
  results: Track[]
): Promise<void> {
  const seed = seedArtist.trim().toLowerCase();
  if (!seed || !isTauri() || results.length === 0) return;
  // Sanatçı başına TEK kenar: radyonun başı seed sanatçının kendi şarkılarıyla
  // dolu olduğu için tekilleştirmezsek ağırlık ona yığılır.
  const seen = new Map<string, string>(); // sanatçı → örnek video kimliği
  for (const r of results) {
    const a = effectiveArtist(r).trim().toLowerCase();
    if (!a || a === seed || !r.sourceId) continue;
    if (!seen.has(a)) seen.set(a, r.sourceId);
  }
  if (seen.size === 0) return;

  try {
    const db = await getDb();
    const now = Date.now();
    const entries = [...seen.entries()];
    // SQLite değişken sınırı (999) → parça parça yaz.
    const CHUNK = 40;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: (string | number)[] = [];
      slice.forEach(([artist, sampleId], idx) => {
        const b = idx * 4; // satır başına 4 parametre (weight sabit 1)
        values.push(`($${b + 1}, $${b + 2}, 1, $${b + 3}, $${b + 4})`);
        params.push(seed, artist, sampleId, now);
      });
      await db.execute(
        `INSERT INTO artist_edges (seed, neighbor, weight, sample_id, updated_at)
         VALUES ${values.join(", ")}
         ON CONFLICT(seed, neighbor) DO UPDATE SET
           weight = artist_edges.weight + 1,
           sample_id = COALESCE(artist_edges.sample_id, excluded.sample_id),
           updated_at = excluded.updated_at`,
        params
      );
    }
  } catch (e) {
    console.error("[resonance] komşuluk kenarları yazılamadı:", e);
  }
}

export type NeighborSeed = {
  artist: string;
  sourceId: string;
  /** Yayılmış yakınlık puanı (tohum örneklemesinde ağırlık olarak kullanılır). */
  score: number;
  /** Puanı hangi tanıdık sanatçıdan aldı (öneri gerekçesi için). */
  via: string;
};

/**
 * Yakınlık puanını komşulara YAY: sevilen A'nın komşusu B, kendi sinyali
 * olmasa bile A'dan pay alır.
 *
 * @param affinity   sanatçı (özgün yazım) → yakınlık puanı
 * @param exclude    zaten tohum olan / dışlanan sanatçılar (küçük harf)
 */
export function neighborSeeds(
  affinity: Map<string, number>,
  exclude: Set<string>
): NeighborSeed[] {
  const out = new Map<string, NeighborSeed>();
  for (const [artistRaw, aff] of affinity) {
    if (aff <= 0) continue;
    const edges = graph.get(artistRaw.trim().toLowerCase());
    if (!edges) continue;
    const total = edges.reduce((s, e) => s + e.weight, 0) || 1;
    for (const e of edges) {
      if (exclude.has(e.neighbor) || isBlocked(e.neighbor)) continue;
      // Payı normalize et: çok komşulu bir radyo tek tek komşuları şişirmesin.
      const score = aff * (e.weight / total);
      const prev = out.get(e.neighbor);
      if (!prev || score > prev.score) {
        out.set(e.neighbor, {
          artist: e.neighbor,
          sourceId: e.sampleId,
          score,
          via: artistRaw,
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}

/** Grafik sonsuza kadar büyümesin: tohum başına en zayıf kenarları at. */
export async function pruneGraph(): Promise<void> {
  if (!isTauri()) return;
  try {
    const db = await getDb();
    await db.execute(
      `DELETE FROM artist_edges
        WHERE rowid IN (
          SELECT rowid FROM (
            SELECT rowid,
                   ROW_NUMBER() OVER (PARTITION BY seed ORDER BY weight DESC, updated_at DESC) AS rn
              FROM artist_edges
          ) WHERE rn > $1
        )`,
      [MAX_EDGES_PER_SEED]
    );
  } catch (e) {
    console.error("[resonance] grafik budanamadı:", e);
  }
}

/** UI/teşhis: grafiğin boyutu. */
export async function graphSize(): Promise<{ seeds: number; edges: number }> {
  if (!isTauri()) return { seeds: 0, edges: 0 };
  try {
    const db = await getDb();
    const rows = await db.select<{ seeds: number; edges: number }[]>(
      `SELECT COUNT(DISTINCT seed) AS seeds, COUNT(*) AS edges FROM artist_edges`
    );
    return { seeds: rows[0]?.seeds ?? 0, edges: rows[0]?.edges ?? 0 };
  } catch {
    return { seeds: 0, edges: 0 };
  }
}
