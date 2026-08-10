import { getDb } from "./db";
import { t } from "./i18n";
import { getDeviceId, newUid } from "./device";

// Dışa aktarılan JSON yedeğini içe aktarma (birleştirme).
// Dışa aktarma SettingsView.exportData'da üretilir: tüm tabloların ham satırları.
// İçe aktarma bunları MEVCUT veriyle BİRLEŞTİRİR (silmez):
//   - tracks / playlists / playlist_tracks → ekle veya güncelle (ON CONFLICT)
//   - votes → çift kayıt eklemeden ekle (karma günlüğü korunur)
//   - settings → İÇE AKTARILMAZ (gizli anahtarlar -Spotify secret, çerez- sızmasın)
// Böylece hem kendi yedeğini taşıma hem başkasının listelerini paylaşma çalışır.

type Row = Record<string, unknown>;

interface Backup {
  version: number;
  playlists?: Row[];
  playlistTracks?: Row[];
  tracks?: Row[];
  votes?: Row[];
  settings?: Row[];
}

export interface ImportResult {
  playlists: number;
  tracks: number;
  links: number;
  votes: number;
}

function asNum(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function asStr(v: unknown): string {
  return v == null ? "" : String(v);
}

export async function importBackup(json: string): Promise<ImportResult> {
  let data: Backup;
  try {
    data = JSON.parse(json) as Backup;
  } catch {
    throw new Error(t("backup.readFailed"));
  }
  if (!data || data.version !== 1 || !Array.isArray(data.tracks)) {
    throw new Error(t("backup.invalid"));
  }

  const db = await getDb();
  const res: ImportResult = { playlists: 0, tracks: 0, links: 0, votes: 0 };
  const now = Date.now();

  // 1) tracks (FK hedefi → playlist_tracks/votes'tan önce)
  for (const t of data.tracks ?? []) {
    if (!t.id) continue;
    await db.execute(
      `INSERT INTO tracks
         (id, source, source_id, title, artist, album, duration_ms, thumbnail, added_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, artist=excluded.artist, album=excluded.album,
         duration_ms=excluded.duration_ms, thumbnail=excluded.thumbnail,
         updated_at=excluded.updated_at`,
      [
        asStr(t.id),
        asStr(t.source) || "youtube",
        asStr(t.source_id),
        asStr(t.title) || "Bilinmeyen",
        asStr(t.artist),
        t.album ?? null,
        asNum(t.duration_ms),
        t.thumbnail ?? null,
        asNum(t.added_at, now),
        now,
      ]
    );
    res.tracks++;
  }

  // 2) playlists
  for (const p of data.playlists ?? []) {
    if (!p.id) continue;
    await db.execute(
      // deleted=0: yedekten geri yükleme, o listeyi diriltmek demektir.
      `INSERT INTO playlists (id, name, description, source, source_url, created_at, updated_at, deleted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, description=excluded.description,
         source=excluded.source, source_url=excluded.source_url,
         updated_at=excluded.updated_at, deleted=0`,
      [
        asStr(p.id),
        asStr(p.name) || t("backup.importedList"),
        p.description ?? null,
        asStr(p.source) || "local",
        p.source_url ?? null,
        asNum(p.created_at, now),
        now,
      ]
    );
    res.playlists++;
  }

  // 3) playlist_tracks (track_id ve playlist_id yukarıda eklendi)
  for (const pt of data.playlistTracks ?? []) {
    if (!pt.playlist_id || !pt.track_id) continue;
    await db.execute(
      `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at, vote, updated_at, deleted)
       VALUES ($1,$2,$3,$4,$5,$6,0)
       ON CONFLICT(playlist_id, track_id) DO UPDATE SET
         position=excluded.position, vote=excluded.vote,
         updated_at=excluded.updated_at, deleted=0`,
      [
        asStr(pt.playlist_id),
        asStr(pt.track_id),
        asNum(pt.position),
        asNum(pt.added_at, now),
        asNum(pt.vote),
        now,
      ]
    );
    res.links++;
  }

  // 4) votes — çift eklemeyi önle (aynı dosya iki kez içe aktarılırsa karma şişmesin)
  for (const v of data.votes ?? []) {
    if (!v.track_id) continue;
    const dup = await db.select<{ c: number }[]>(
      `SELECT COUNT(*) AS c FROM votes
       WHERE track_id=$1 AND created_at=$2 AND value=$3`,
      [asStr(v.track_id), asNum(v.created_at), asNum(v.value)]
    );
    if ((dup[0]?.c ?? 0) > 0) continue;
    await db.execute(
      `INSERT INTO votes (track_id, playlist_id, value, created_at, hour, dow, uid, device_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        asStr(v.track_id),
        v.playlist_id ?? null,
        asNum(v.value),
        asNum(v.created_at, now),
        asNum(v.hour),
        asNum(v.dow),
        newUid(),
        getDeviceId(),
        now,
      ]
    );
    res.votes++;
  }

  return res;
}
