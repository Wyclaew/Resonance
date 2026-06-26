import type { Track } from "../types";
import { getDb, isTauri } from "./db";

// Son çalınan benzersiz parçalar (en yeni önce) — "Şu An" ekranı için.
export async function getRecentTracks(limit = 12): Promise<Track[]> {
  if (!isTauri()) return [];
  try {
    const db = await getDb();
    const rows = await db.select<
      {
        id: string;
        source: string;
        sourceId: string;
        title: string;
        artist: string;
        album: string | null;
        durationMs: number;
        thumbnail: string | null;
        addedAt: number;
      }[]
    >(
      `SELECT t.id, t.source, t.source_id AS sourceId, t.title, t.artist, t.album,
              t.duration_ms AS durationMs, t.thumbnail, t.added_at AS addedAt,
              MAX(h.played_at) AS last
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       GROUP BY t.id
       ORDER BY last DESC
       LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      id: r.id,
      source: r.source as Track["source"],
      sourceId: r.sourceId,
      title: r.title,
      artist: r.artist,
      album: r.album ?? undefined,
      durationMs: r.durationMs,
      thumbnail: r.thumbnail ?? undefined,
      addedAt: r.addedAt,
    }));
  } catch (e) {
    console.error("[resonance] son çalınanlar yüklenemedi:", e);
    return [];
  }
}

// Oynatma geçmişi: ne zaman ne kadar dinlendi (M4 bağlamsal öğrenme +
// öneri geçme/tamamlama sinyali için).
export async function recordPlay(
  trackId: string,
  msPlayed: number
): Promise<void> {
  if (!isTauri() || msPlayed < 1000) return;
  try {
    const db = await getDb();
    const d = new Date();
    await db.execute(
      `INSERT INTO play_history (track_id, played_at, ms_played, hour, dow)
       VALUES ($1, $2, $3, $4, $5)`,
      [trackId, d.getTime(), Math.floor(msPlayed), d.getHours(), d.getDay()]
    );
  } catch (e) {
    console.error("[resonance] geçmiş kaydedilemedi:", e);
  }
}
