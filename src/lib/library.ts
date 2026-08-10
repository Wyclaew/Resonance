import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../types";
import { getDb, isTauri } from "./db";
import { ensureTrack } from "./playlists";
import { useSettingsStore } from "../store/useSettingsStore";

// İndirilenler & kütüphane için SQLite yardımcıları.
// "downloaded=1" kullanıcının açıkça indirdiği kalıcı parçalar.

interface FileInfo {
  path: string;
  bytes: number;
  format: string;
}

export async function addDownload(track: Track, file: FileInfo): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  // ensureTrack: ON CONFLICT DO UPDATE (silmez → cascade tetiklenmez).
  await ensureTrack(track);
  // cache PK track_id; buradan kimse cascade almıyor, REPLACE güvenli.
  await db.execute(
    `INSERT OR REPLACE INTO cache
       (track_id, file_path, bytes, format, last_played, downloaded)
     VALUES ($1,$2,$3,$4,$5,1)`,
    [track.id, file.path, file.bytes, file.format, now]
  );
}

export async function removeDownload(trackId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM cache WHERE track_id = $1`, [trackId]);
}

interface DownloadDbRow {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  thumbnail: string | null;
  addedAt: number;
}

export async function listDownloads(): Promise<Track[]> {
  const db = await getDb();
  const rows = await db.select<DownloadDbRow[]>(
    `SELECT t.id, t.source, t.source_id AS sourceId, t.title, t.artist,
            t.album, t.duration_ms AS durationMs, t.thumbnail, t.added_at AS addedAt
     FROM tracks t
     JOIN cache c ON c.track_id = t.id
     WHERE c.downloaded = 1
     ORDER BY c.last_played DESC, t.added_at DESC`
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
}

export async function getDownloadedIds(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ track_id: string }[]>(
    `SELECT track_id FROM cache WHERE downloaded = 1`
  );
  return rows.map((r) => r.track_id);
}

/**
 * Ses önbelleğini ayarlanan sınırın altına indirir (LRU).
 *
 * ⚠️ Kullanıcının açıkça İNDİRDİĞİ parçalar (`cache.downloaded = 1`) korunur —
 * onlar çevrimdışı dinlemek için orada. Silinenler yalnız çalarken oluşan
 * geçici dosyalardır; gerektiğinde yeniden inerler.
 */
export async function pruneAudioCache(): Promise<void> {
  if (!isTauri()) return;
  try {
    const limitGb = useSettingsStore.getState().cacheLimitGb;
    if (!limitGb || limitGb <= 0) return; // 0 = sınırsız
    // Korunacaklar: kullanıcının açıkça indirdikleri (source_id ile).
    const db = await getDb();
    const rows = await db.select<{ source_id: string }[]>(
      `SELECT t.source_id FROM cache c JOIN tracks t ON t.id = c.track_id
       WHERE c.downloaded = 1`
    );
    const keep = rows.map((r) => r.source_id);
    const res = await invoke<{ deletedBytes: number; deletedCount: number }>(
      "prune_cache",
      { keep, maxBytes: Math.round(limitGb * 1024 * 1024 * 1024) }
    );
    if (res.deletedCount > 0) {
      console.info(
        `[resonance] önbellek budandı: ${res.deletedCount} dosya, ${res.deletedBytes} bayt`
      );
    }
  } catch (e) {
    console.error("[resonance] önbellek budanamadı:", e);
  }
}
