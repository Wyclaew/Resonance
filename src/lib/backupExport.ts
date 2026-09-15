import { getDb } from "./db";

// Yedek JSON'u TEK YERDE üretilir: Ayarlar → "Yedeği dışa aktar" ve buluta
// otomatik yedek (cloudBackup.ts) aynı biçimi kullanır → içe aktarma
// (backup.ts) ikisini de tanır.
//
// ⚠️ `deleted = 0` ŞART: tombstone satırlar da yedeğe girerse içe aktarma
// onları diriltir (silinen listeler geri gelir).
export async function buildBackupJson(): Promise<string> {
  const db = await getDb();
  const [playlists, playlistTracks, tracks, votes, settings] = await Promise.all([
    db.select("SELECT * FROM playlists WHERE deleted = 0"),
    db.select("SELECT * FROM playlist_tracks WHERE deleted = 0"),
    db.select("SELECT * FROM tracks"),
    db.select("SELECT * FROM votes WHERE deleted = 0"),
    db.select("SELECT * FROM settings"),
  ]);
  return JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    playlists,
    playlistTracks,
    tracks,
    votes,
    settings,
  });
}
