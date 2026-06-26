import type { Playlist, PlaylistTrack, Track, Vote } from "../types";
import { getDb } from "./db";
import { computeKarma, type VoteEvent } from "./karma";

// Çalma listesi & şarkı ilişkisi için SQLite yardımcıları.

export async function listPlaylists(): Promise<Playlist[]> {
  const db = await getDb();
  const rows = await db.select<
    {
      id: string;
      name: string;
      description: string | null;
      source: string;
      sourceUrl: string | null;
      createdAt: number;
      trackCount: number;
    }[]
  >(
    `SELECT p.id, p.name, p.description, p.source, p.source_url AS sourceUrl,
            p.created_at AS createdAt, COUNT(pt.track_id) AS trackCount
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     GROUP BY p.id
     ORDER BY p.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    source: (r.source as Playlist["source"]) ?? "local",
    sourceUrl: r.sourceUrl ?? undefined,
    createdAt: r.createdAt,
    trackCount: r.trackCount,
  }));
}

export async function createPlaylist(
  name: string,
  description?: string
): Promise<Playlist> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    `INSERT INTO playlists (id, name, description, source, source_url, created_at)
     VALUES ($1, $2, $3, 'local', NULL, $4)`,
    [id, name.trim() || "İsimsiz liste", description ?? null, now]
  );
  return {
    id,
    name: name.trim() || "İsimsiz liste",
    description,
    source: "local",
    createdAt: now,
    trackCount: 0,
  };
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE playlists SET name = $1 WHERE id = $2`, [
    name.trim() || "İsimsiz liste",
    id,
  ]);
}

export async function deletePlaylist(id: string): Promise<void> {
  const db = await getDb();
  // playlist_tracks ON DELETE CASCADE ile temizlenir.
  await db.execute(`DELETE FROM playlists WHERE id = $1`, [id]);
}

// Bir parça metadata'sını tracks tablosuna yazar (FK için gerekli).
// ÖNEMLİ: INSERT OR REPLACE KULLANMA — satırı silip yeniden eklediği için
// playlist_tracks/cache'teki ON DELETE CASCADE şarkıyı tüm listelerden uçurur.
// ON CONFLICT DO UPDATE yerinde günceller (silme yok, cascade tetiklenmez).
export async function ensureTrack(track: Track): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO tracks
       (id, source, source_id, title, artist, album, duration_ms, thumbnail, added_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, artist=excluded.artist, album=excluded.album,
       duration_ms=excluded.duration_ms, thumbnail=excluded.thumbnail`,
    [
      track.id,
      track.source,
      track.sourceId,
      track.title,
      track.artist,
      track.album ?? null,
      track.durationMs,
      track.thumbnail ?? null,
      track.addedAt ?? Date.now(),
    ]
  );
}

// Parçayı listeye ekler. Zaten varsa false döner.
export async function addTrackToPlaylist(
  playlistId: string,
  track: Track
): Promise<boolean> {
  const db = await getDb();
  await ensureTrack(track);

  const exists = await db.select<{ c: number }[]>(
    `SELECT COUNT(*) AS c FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
    [playlistId, track.id]
  );
  if (exists[0]?.c > 0) return false;

  const posRow = await db.select<{ pos: number }[]>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM playlist_tracks WHERE playlist_id = $1`,
    [playlistId]
  );
  const position = posRow[0]?.pos ?? 0;
  await db.execute(
    `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
     VALUES ($1, $2, $3, $4)`,
    [playlistId, track.id, position, Date.now()]
  );
  return true;
}

// Çok sayıda parçayı sırayla ekler, ilerlemeyi bildirir (içe aktarma için).
export async function importTracks(
  playlistId: string,
  tracks: Track[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < tracks.length; i++) {
    await addTrackToPlaylist(playlistId, tracks[i]);
    onProgress?.(i + 1, tracks.length);
  }
}

export async function removeTrackFromPlaylist(
  playlistId: string,
  trackId: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
    [playlistId, trackId]
  );
}

export async function getPlaylist(id: string): Promise<Playlist | null> {
  const all = await listPlaylists();
  return all.find((p) => p.id === id) ?? null;
}

// Listedeki parçalar — güncel oy (pt.vote) + decay'li karma (votes günlüğünden).
export async function getPlaylistTracks(
  playlistId: string
): Promise<PlaylistTrack[]> {
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
      position: number;
      vote: number;
    }[]
  >(
    `SELECT t.id, t.source, t.source_id AS sourceId, t.title, t.artist, t.album,
            t.duration_ms AS durationMs, t.thumbnail, t.added_at AS addedAt,
            pt.position, pt.vote
     FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = $1
     ORDER BY pt.position ASC`,
    [playlistId]
  );

  // Karma için oy olaylarını çek ve parça başına decay'li topla.
  const events = await db.select<
    { track_id: string; value: number; created_at: number }[]
  >(
    `SELECT track_id, value, created_at FROM votes WHERE playlist_id = $1`,
    [playlistId]
  );
  const byTrack = new Map<string, VoteEvent[]>();
  const lastAt = new Map<string, number>();
  const lastDir = new Map<string, number>();
  for (const e of events) {
    const arr = byTrack.get(e.track_id) ?? [];
    arr.push({ value: e.value, createdAt: e.created_at });
    byTrack.set(e.track_id, arr);
    if (e.created_at >= (lastAt.get(e.track_id) ?? 0)) {
      lastAt.set(e.track_id, e.created_at);
      lastDir.set(e.track_id, Math.sign(e.value));
    }
  }
  const now = Date.now();

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
    position: r.position,
    karma: computeKarma(byTrack.get(r.id) ?? [], now),
    myVote: ((lastDir.get(r.id) ?? 0) as Vote),
    lastVoteAt: lastAt.get(r.id),
  }));
}

// Tek bir parçanın (bir liste bağlamındaki) karma + son oy bilgisi.
// Alt baradan (NowPlayingBar) çalan şarkıyı oylamak için.
export async function getTrackKarma(
  playlistId: string,
  trackId: string
): Promise<{ karma: number; lastVoteAt?: number; myVote: Vote }> {
  const db = await getDb();
  const events = await db.select<{ value: number; created_at: number }[]>(
    `SELECT value, created_at FROM votes WHERE playlist_id = $1 AND track_id = $2`,
    [playlistId, trackId]
  );
  const voteEvents: VoteEvent[] = events.map((e) => ({
    value: e.value,
    createdAt: e.created_at,
  }));
  let lastAt: number | undefined;
  let lastDir = 0;
  for (const e of events) {
    if (lastAt == null || e.created_at >= lastAt) {
      lastAt = e.created_at;
      lastDir = Math.sign(e.value);
    }
  }
  return {
    karma: computeKarma(voteEvents, Date.now()),
    lastVoteAt: lastAt,
    myVote: lastDir as Vote,
  };
}

// Bir parçaya oy ver — BİRİKEN model (toggle yok): her up +1, down -1 ekler.
// Şarkı başına saatte 1 (cooldown). Olay zaman bağlamıyla loglanır (karma + M4).
export async function voteTrack(
  playlistId: string,
  trackId: string,
  direction: 1 | -1
): Promise<{ ok: boolean; cooldownRemainingMs: number }> {
  const db = await getDb();

  // Cooldown kontrolü: bu (playlist, şarkı) için son oy ne zamandı?
  const lastRows = await db.select<{ last: number | null }[]>(
    `SELECT MAX(created_at) AS last FROM votes WHERE playlist_id = $1 AND track_id = $2`,
    [playlistId, trackId]
  );
  const last = lastRows[0]?.last ?? 0;
  const now = Date.now();
  const remaining = Math.max(0, (last ?? 0) + 60 * 60 * 1000 - now);
  if (remaining > 0) {
    return { ok: false, cooldownRemainingMs: remaining };
  }

  const d = new Date();
  await db.execute(
    `INSERT INTO votes (track_id, playlist_id, value, created_at, hour, dow)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [trackId, playlistId, direction, now, d.getHours(), d.getDay()]
  );
  // Son oy yönünü ipucu olarak sakla.
  await db.execute(
    `UPDATE playlist_tracks SET vote = $1 WHERE playlist_id = $2 AND track_id = $3`,
    [direction, playlistId, trackId]
  );

  return { ok: true, cooldownRemainingMs: 60 * 60 * 1000 };
}

// Sürükle-bırak sonrası yeni sırayı kaydeder.
export async function reorderPlaylist(
  playlistId: string,
  orderedTrackIds: string[]
): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < orderedTrackIds.length; i++) {
    await db.execute(
      `UPDATE playlist_tracks SET position = $1 WHERE playlist_id = $2 AND track_id = $3`,
      [i, playlistId, orderedTrackIds[i]]
    );
  }
}
