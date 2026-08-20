import type { Track } from "../types";
import { getDb, isTauri } from "./db";
import { ensureTrack } from "./playlists";
import { getDeviceId, newUid } from "./device";
import { notifyLocalChange } from "./sync/engine";

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

// Oynatma geçmişi: ne zaman ne kadar dinlendi (bağlamsal öğrenme +
// öneri geçme/tamamlama sinyali için).
//
// ⚠️ ÖNCE `ensureTrack` — yoksa KAYIT ALGORİTMAYA ULAŞMAZ. recommender.ts
// geçmişi `play_history h JOIN tracks t` (INNER) ile okur. Keşfet/radyo parçası
// hiçbir listede olmadığı için `tracks`'te de yoktu → JOIN kaydı düşürüyordu.
// Ölçüldü: 375 kaydın 104'ü YETİMDİ ve bunlar EN UZUN dinlemelerdi (440sn'ye
// kadar) — yani kullanıcının gerçekten sevdiği şarkılar öğrenmeye hiç
// katılmıyordu; algoritma yalnız atlanan şarkıları görüp "hiçbir şeyi
// tamamlamıyor" sanıyordu. (Aynı hata oylamada da vardı, bkz. CLAUDE.md #13.)
//
// Bu bir listeye EKLEME değildir: İndirilenler `cache.downloaded=1` ister,
// Kütüphane playlist'leri gösterir → parça yalnız öğrenme sinyali olarak sayılır.
export async function recordPlay(track: Track, msPlayed: number): Promise<void> {
  if (!isTauri() || msPlayed < 1000) return;
  try {
    await ensureTrack(track);
    const db = await getDb();
    const d = new Date();
    await db.execute(
      `INSERT INTO play_history
         (track_id, played_at, ms_played, hour, dow, uid, device_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $2)`,
      [
        track.id,
        d.getTime(),
        Math.floor(msPlayed),
        d.getHours(),
        d.getDay(),
        newUid(),
        getDeviceId(),
      ]
    );
    notifyLocalChange();
  } catch (e) {
    console.error("[resonance] geçmiş kaydedilemedi:", e);
  }
}

/**
 * ⭐ BU HAFTANIN KEŞİFLERİ: son 7 günde İLK KEZ dinlediğin sanatçıların
 * parçaları. "Keşfet gerçekten yeni bir şey buldu mu?" sorusunun somut cevabı.
 *
 * İki düz sorgu + JS kesişimi kullanılıyor; korelasyonlu alt sorgu (parça
 * başına geçmiş taraması) binlerce satırda O(n·m) olurdu.
 */
export async function weekDiscoveries(limit = 8): Promise<Track[]> {
  if (!isTauri()) return [];
  try {
    const db = await getDb();
    const since = Date.now() - 7 * 24 * 3600 * 1000;

    // Aralıktan ÖNCE dinlenmiş sanatçılar (yani "yeni" sayılmayanlar).
    const known = await db.select<{ artist: string }[]>(
      `SELECT DISTINCT t.artist
         FROM play_history h JOIN tracks t ON t.id = h.track_id
        WHERE h.played_at < $1 AND t.artist <> ''`,
      [since]
    );
    const seen = new Set(known.map((k) => k.artist.toLowerCase()));

    const rows = await db.select<
      {
        id: string;
        source: string;
        sourceId: string;
        title: string;
        artist: string;
        durationMs: number;
        thumbnail: string | null;
        last: number;
      }[]
    >(
      `SELECT t.id, t.source, t.source_id AS sourceId, t.title, t.artist,
              t.duration_ms AS durationMs, t.thumbnail, MAX(h.played_at) AS last
         FROM play_history h JOIN tracks t ON t.id = h.track_id
        WHERE h.played_at >= $1 AND h.ms_played > 30000 AND t.artist <> ''
        GROUP BY t.id
        ORDER BY last DESC`,
      [since]
    );

    const out: Track[] = [];
    const usedArtists = new Set<string>();
    for (const r of rows) {
      const a = r.artist.toLowerCase();
      if (seen.has(a) || usedArtists.has(a)) continue; // yeni değil / tekrar
      usedArtists.add(a);
      out.push({
        id: r.id,
        source: r.source as Track["source"],
        sourceId: r.sourceId,
        title: r.title,
        artist: r.artist,
        durationMs: r.durationMs,
        thumbnail: r.thumbnail ?? undefined,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    console.error("[resonance] haftanın keşifleri okunamadı:", e);
    return [];
  }
}
