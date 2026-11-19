import { getDb, isTauri } from "./db";
import { LIBRARY_CHANGED_EVENT } from "./placeholderRepair";
import type { Track } from "../types";

// ⭐ KÜTÜPHANE ARAMASI (komut paleti + Ara sayfası): "bu şarkı bende var mı,
// hangi listede?" sorusuna YouTube'a gitmeden, anında cevap.
//
// ⚠️ "Kütüphane" = en az bir CANLI listede (silinmemiş üyelik + silinmemiş
// liste) olan parça. `tracks` tablosunda her önerilen/oylanan parça da durur
// (CLAUDE.md gotcha #13) — yalnız `tracks`'e bakılsaydı Keşfet önerileri de
// "kütüphanemde" diye çıkardı. Silme = tombstone olduğu için `deleted = 0`
// HER İKİ tabloda da şart (senkron bölümü).
//
// ⚠️ SQLite LOWER()/LIKE ASCII dışını katlamaz ("İ"/"ı"/"Ş"…), bu yüzden
// arama SQL'de değil JS'te: ~3.4k parça bellekte, normalleştirilmiş anahtarla
// aranır. FTS5 gereksiz.

export const LIBRARY_SEARCH_LIMIT = 50;

export interface LibraryHit {
  track: Track;
  /** Parçayı içeren canlı listelerin adları (ada göre sıralı). */
  playlists: { id: string; name: string }[];
}

interface Entry extends LibraryHit {
  nTitle: string;
  nArtist: string;
  nAll: string;
}

// Türkçe-farkındalıklı katlama: önce tr yerel ayarıyla küçült (İ→i, I→ı),
// sonra ı→i, ş→s, ç→c, ğ→g, ö→o, ü→u ve kalan aksanları sök. Böylece "ISIK",
// "ışık", "isik" ve "Işık" hepsi aynı anahtara iner.
export function normalizeSearch(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

let cache: { stamp: string; entries: Entry[] } | null = null;
let loading: Promise<Entry[]> | null = null;

// Üyelik/liste değişince önbellek geçersiz. Olay ucuz; asıl koruma aşağıdaki
// parmak izi (uzak senkronla gelen değişiklik olay yaymayabilir).
if (typeof window !== "undefined") {
  window.addEventListener(LIBRARY_CHANGED_EVENT, () => {
    cache = null;
  });
}

async function fingerprint(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ c: number; m: number; p: number }[]>(
    `SELECT COUNT(*) AS c, COALESCE(MAX(pt.updated_at), 0) AS m,
            (SELECT COUNT(*) FROM playlists WHERE deleted = 0) AS p
     FROM playlist_tracks pt WHERE pt.deleted = 0`
  );
  const r = rows[0];
  return `${r?.c ?? 0}:${r?.m ?? 0}:${r?.p ?? 0}`;
}

async function loadEntries(): Promise<Entry[]> {
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
      pid: string;
      pname: string;
    }[]
  >(
    `SELECT t.id, t.source, t.source_id AS sourceId, t.title, t.artist, t.album,
            t.duration_ms AS durationMs, t.thumbnail, t.added_at AS addedAt,
            p.id AS pid, p.name AS pname
     FROM tracks t
     JOIN playlist_tracks pt ON pt.track_id = t.id AND pt.deleted = 0
     JOIN playlists p ON p.id = pt.playlist_id AND p.deleted = 0
     WHERE t.title <> ''`
  );
  const byId = new Map<string, Entry>();
  for (const r of rows) {
    let e = byId.get(r.id);
    if (!e) {
      const nTitle = normalizeSearch(r.title);
      const nArtist = normalizeSearch(r.artist);
      e = {
        track: {
          id: r.id,
          source: r.source as Track["source"],
          sourceId: r.sourceId,
          title: r.title,
          artist: r.artist,
          album: r.album ?? undefined,
          durationMs: r.durationMs,
          thumbnail: r.thumbnail ?? undefined,
          addedAt: r.addedAt,
        },
        playlists: [],
        nTitle,
        nArtist,
        nAll: `${nTitle} ${nArtist}`,
      };
      byId.set(r.id, e);
    }
    e.playlists.push({ id: r.pid, name: r.pname });
  }
  const out = [...byId.values()];
  for (const e of out) {
    e.playlists.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }
  return out;
}

async function getEntries(): Promise<Entry[]> {
  const stamp = await fingerprint();
  if (cache && cache.stamp === stamp) return cache.entries;
  // Aynı anda gelen çağrılar tek yüklemeyi paylaşsın (yazdıkça çağrılıyor).
  if (!loading) {
    loading = loadEntries()
      .then((entries) => {
        cache = { stamp, entries };
        return entries;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

// Skor (küçük = iyi): başlık tam/önek eşleşmesi > sanatçı > içerik. Eşitlikte
// daha çok listede olan (sevilen) parça öne.
function rank(e: Entry, q: string): number {
  if (e.nTitle === q) return 0;
  if (e.nTitle.startsWith(q)) return 1;
  if (e.nArtist === q) return 2;
  if (e.nArtist.startsWith(q)) return 3;
  return 4;
}

export async function searchLibrary(
  query: string,
  limit = LIBRARY_SEARCH_LIMIT
): Promise<LibraryHit[]> {
  if (!isTauri()) return [];
  const q = normalizeSearch(query);
  if (q.length < 2) return [];
  const tokens = q.split(" ");
  const entries = await getEntries();
  const hits: { e: Entry; r: number }[] = [];
  for (const e of entries) {
    if (tokens.every((tok) => e.nAll.includes(tok))) {
      hits.push({ e, r: rank(e, q) });
    }
  }
  hits.sort(
    (a, b) => a.r - b.r || b.e.playlists.length - a.e.playlists.length
  );
  return hits
    .slice(0, limit)
    .map(({ e }) => ({ track: e.track, playlists: e.playlists }));
}

/** "Liste A, Liste B +2" — satıra sığacak kısa özet. */
export function playlistsHint(hit: LibraryHit, max = 2): string {
  const names = hit.playlists.slice(0, max).map((p) => p.name);
  const more = hit.playlists.length - names.length;
  return more > 0 ? `${names.join(", ")} +${more}` : names.join(", ");
}
