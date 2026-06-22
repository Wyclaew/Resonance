import { getDb, isTauri } from "./db";

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
