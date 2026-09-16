import { getDb, isTauri } from "./db";

// Yıllık özet verisi — hem sayfa (`WrappedView`) hem hikâye (`WrappedStory`)
// aynı hesabı kullanır. Kaynak: play_history ⨝ tracks (senkronlanıyor → tüm
// cihazların toplamı) + recommendation_history.

export type WrappedRow = { name: string; plays: number; ms: number };

export interface WrappedData {
  totalMs: number;
  plays: number;
  artists: number;
  newArtists: number;
  topArtists: WrappedRow[];
  topTracks: WrappedRow[];
  peakHour: number;
  recommended: number;
  recAccepted: number;
  newGenres: number;
  longestStreak: number;
}

export const EMPTY_WRAPPED: WrappedData = {
  totalMs: 0,
  plays: 0,
  artists: 0,
  newArtists: 0,
  topArtists: [],
  topTracks: [],
  peakHour: 0,
  recommended: 0,
  recAccepted: 0,
  newGenres: 0,
  longestStreak: 0,
};

export function wrappedRange(year: number | "12m"): { from: number; to: number } {
  if (year === "12m") {
    return { from: Date.now() - 365 * 24 * 3600 * 1000, to: Date.now() };
  }
  return {
    from: new Date(year, 0, 1).getTime(),
    to: new Date(year + 1, 0, 1).getTime(),
  };
}

export async function loadWrapped(year: number | "12m"): Promise<WrappedData> {
  if (!isTauri()) return EMPTY_WRAPPED;
  const range = wrappedRange(year);
  try {
      const db = await getDb();
      const { from, to } = range;

      const tot = await db.select<{ ms: number; c: number; a: number }[]>(
        `SELECT COALESCE(SUM(h.ms_played),0) AS ms, COUNT(*) AS c,
                COUNT(DISTINCT t.artist) AS a
           FROM play_history h JOIN tracks t ON t.id = h.track_id
          WHERE h.played_at >= $1 AND h.played_at < $2`,
        [from, to]
      );
      const topArtists = await db.select<WrappedRow[]>(
        `SELECT t.artist AS name, COUNT(*) AS plays, SUM(h.ms_played) AS ms
           FROM play_history h JOIN tracks t ON t.id = h.track_id
          WHERE h.played_at >= $1 AND h.played_at < $2 AND t.artist <> ''
          GROUP BY t.artist ORDER BY ms DESC LIMIT 5`,
        [from, to]
      );
      const topTracks = await db.select<WrappedRow[]>(
        `SELECT t.title AS name, COUNT(*) AS plays, SUM(h.ms_played) AS ms
           FROM play_history h JOIN tracks t ON t.id = h.track_id
          WHERE h.played_at >= $1 AND h.played_at < $2
          GROUP BY t.id ORDER BY plays DESC, ms DESC LIMIT 5`,
        [from, to]
      );
      // "Yeni keşfedilen sanatçı": aralıkta dinlendi, aralıktan ÖNCE hiç yok.
      const fresh = await db.select<{ c: number }[]>(
        `SELECT COUNT(*) AS c FROM (
           SELECT t.artist FROM play_history h JOIN tracks t ON t.id = h.track_id
            WHERE h.played_at >= $1 AND h.played_at < $2 AND t.artist <> ''
            GROUP BY t.artist
           EXCEPT
           SELECT t.artist FROM play_history h JOIN tracks t ON t.id = h.track_id
            WHERE h.played_at < $1 AND t.artist <> ''
            GROUP BY t.artist)`,
        [from, to]
      );
      const hours = await db.select<{ hour: number; ms: number }[]>(
        `SELECT hour, SUM(ms_played) AS ms FROM play_history
          WHERE played_at >= $1 AND played_at < $2 GROUP BY hour
          ORDER BY ms DESC LIMIT 1`,
        [from, to]
      );
      const rec = await db.select<{ c: number }[]>(
        `SELECT COUNT(*) AS c FROM recommendation_history
          WHERE recommended_at >= $1 AND recommended_at < $2`,
        [from, to]
      );
      // Kabul edilen öneri: önerildikten sonra en az %40'ı dinlenmiş.
      const accepted = await db.select<{ c: number }[]>(
        `SELECT COUNT(*) AS c FROM recommendation_history r
           JOIN tracks t ON t.id = r.track_id
          WHERE r.recommended_at >= $1 AND r.recommended_at < $2
            AND t.duration_ms > 0
            AND (SELECT MAX(h.ms_played) FROM play_history h
                  WHERE h.track_id = r.track_id
                    AND h.played_at >= r.recommended_at) * 1.0
                / t.duration_ms >= 0.4`,
        [from, to]
      );
      // Yeni müzik türü: bu aralıkta ilk kez karşılaşılan etiket sayısı
      // (artist_tags yerelde birikiyor — tür alanının tek kaynağı).
      const genres = await db.select<{ c: number }[]>(
        `SELECT COUNT(DISTINCT g.tag) AS c
           FROM artist_tags g
           JOIN tracks t ON lower(t.artist) = g.artist
           JOIN play_history h ON h.track_id = t.id
          WHERE h.played_at >= $1 AND h.played_at < $2`,
        [from, to]
      );
      // En uzun dinleme serisi (arka arkaya kaç gün).
      const days = await db.select<{ d: number }[]>(
        `SELECT DISTINCT CAST(played_at / 86400000 AS INTEGER) AS d
           FROM play_history WHERE played_at >= $1 AND played_at < $2
          ORDER BY d ASC`,
        [from, to]
      );
      let streak = 0;
      let best = 0;
      let prev: number | null = null;
      for (const row of days) {
        streak = prev !== null && row.d === prev + 1 ? streak + 1 : 1;
        if (streak > best) best = streak;
        prev = row.d;
      }

      return {
        totalMs: tot[0]?.ms ?? 0,
        plays: tot[0]?.c ?? 0,
        artists: tot[0]?.a ?? 0,
        newArtists: fresh[0]?.c ?? 0,
        topArtists,
        topTracks,
        peakHour: hours[0]?.hour ?? 0,
        recommended: rec[0]?.c ?? 0,
        recAccepted: accepted[0]?.c ?? 0,
        newGenres: genres[0]?.c ?? 0,
        longestStreak: best,
      };
  } catch (e) {
    console.error("[resonance] yıllık özet hesaplanamadı:", e);
    return EMPTY_WRAPPED;
  }
}
