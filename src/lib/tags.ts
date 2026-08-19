import type { Track } from "../types";
import { getDb, isTauri } from "./db";
import { DISCOVERY_FILTERS } from "./filters";
import { t as translate, type TrKey } from "./i18n";

// ═══════════════════════════════════════════════════════════════════════════
// SANATÇI ETİKETLERİ — "bu sanatçı hangi tür/ruh hali?"
//
// PROBLEM: veritabanında TÜR ALANI YOK (tracks yalnız başlık/sanatçı/süre
// tutar). Bu yüzden Keşfet'teki "şu anki modun" satırı, tarz vekili olarak
// SEED SANATÇI ADINI gösteriyordu — kullanıcının gördüğü "Portugal. The Man"
// gibi. Anlaşılır değil: kullanıcı "sakin", "enerjik" bekliyor.
//
// ÇÖZÜM: küratörlü tür/ruh hali havuzu (music_genre_pool) zaten çekiliyor ve
// hangi sanatçının hangi filtre havuzunda çıktığı BİLİNİYOR — bu bilgi
// kullanılmadan atılıyordu. Havuzdaki sanatçılara filtre kimliğini etiket
// olarak yazıyoruz; zamanla sanatçı → "sakin/rock" eşlemesi birikiyor.
//
// ⛔ SENKRONLANMAZ: sayaç (bkz. lib/graph.ts'teki aynı gerekçe).
// ═══════════════════════════════════════════════════════════════════════════

let tags = new Map<string, Map<string, number>>();
let loaded = false;

/** YT Music liste girdilerinde `artist` kanal adıdır; gerçek sanatçı başlıkta. */
function effectiveArtist(tr: Track): string {
  const dash = tr.title.split(/\s[-–—]\s/);
  if (dash.length > 1 && dash[0].trim().length >= 2) return dash[0].trim();
  return tr.artist;
}

export async function loadTags(force = false): Promise<void> {
  if (!isTauri()) return;
  if (loaded && !force) return;
  try {
    const db = await getDb();
    const rows = await db.select<{ artist: string; tag: string; weight: number }[]>(
      `SELECT artist, tag, weight FROM artist_tags`
    );
    const next = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const m = next.get(r.artist) ?? new Map<string, number>();
      m.set(r.tag, r.weight);
      next.set(r.artist, m);
    }
    tags = next;
    loaded = true;
  } catch (e) {
    console.error("[resonance] sanatçı etiketleri okunamadı:", e);
  }
}

/** Tür havuzunda görülen sanatçıları filtre kimlikleriyle etiketle. */
export async function noteGenrePool(
  filterIds: string[],
  results: Track[]
): Promise<void> {
  if (!isTauri() || filterIds.length === 0 || results.length === 0) return;
  const artists = new Set<string>();
  for (const r of results) {
    const a = effectiveArtist(r).trim().toLowerCase();
    if (a) artists.add(a);
  }
  if (artists.size === 0) return;

  try {
    const db = await getDb();
    const now = Date.now();
    const pairs: [string, string][] = [];
    for (const a of artists) for (const f of filterIds) pairs.push([a, f]);

    const CHUNK = 60; // SQLite değişken sınırı (999) altında kal
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const slice = pairs.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: (string | number)[] = [];
      slice.forEach(([artist, tag], idx) => {
        const b = idx * 3;
        values.push(`($${b + 1}, $${b + 2}, 1, $${b + 3})`);
        params.push(artist, tag, now);
      });
      await db.execute(
        `INSERT INTO artist_tags (artist, tag, weight, updated_at)
         VALUES ${values.join(", ")}
         ON CONFLICT(artist, tag) DO UPDATE SET
           weight = artist_tags.weight + 1, updated_at = excluded.updated_at`,
        params
      );
      // Bellek içi kopyayı da güncelle (yeniden okumaya gerek kalmasın).
      for (const [artist, tag] of slice) {
        const m = tags.get(artist) ?? new Map<string, number>();
        m.set(tag, (m.get(tag) ?? 0) + 1);
        tags.set(artist, m);
      }
    }
  } catch (e) {
    console.error("[resonance] sanatçı etiketi yazılamadı:", e);
  }
}

/** Filtre kimliğini o anki dilde okunur etikete çevirir. */
function labelOf(id: string): string | null {
  const f = DISCOVERY_FILTERS.find((x) => x.id === id);
  return f ? translate(f.labelKey as TrKey) : null;
}

/**
 * Verilen sanatçıların ortak etiketleri — Keşfet'teki "şu anki modun" satırı.
 * Etiket birikmemişse boş döner; çağıran taraf sanatçı adına düşer.
 */
export function labelsForArtists(artists: string[], max = 3): string[] {
  const score = new Map<string, number>();
  for (const a of artists) {
    const m = tags.get(a.trim().toLowerCase());
    if (!m) continue;
    for (const [tag, w] of m) score.set(tag, (score.get(tag) ?? 0) + w);
  }
  return [...score.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, max)
    .map(([id]) => labelOf(id))
    .filter((x): x is string => !!x);
}
