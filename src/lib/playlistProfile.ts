import { getDb, isTauri } from "./db";
import { decayWeight } from "./karma";
import { notifyLocalChange } from "./sync/engine";
import {
  durationFit,
  isComplete,
  isSkip,
  listenRatio,
  scriptFit,
  titleScript,
  type TitleScript,
} from "./tasteParams";

/**
 * ⭐ LİSTE PROFİLİ — mobilden taşındı, kullanıcı isteği: "her listenin kendi zevk
 * profili olsun, genel zevkimi etkilemesin; spor listemde yalnız phonk gelsin."
 *
 * İKİ AYRI PARÇA, ayrı saklanır:
 *  - TARZ (`PlaylistStyle`): kullanıcının SEÇTİĞİ şey. `playlists.style_json`,
 *    senkronlanır → iki cihazda aynı, uygulama kapanınca unutulmaz.
 *  - ÖĞRENİLEN (`PlaylistTaste`): TABLO YOK, `play_history.playlist_id` +
 *    `votes.playlist_id` üstünden HER SEFERİNDE TÜRETİLİR (taste.ts ile aynı
 *    gerekçe): sayaç saklansaydı iki cihazın öğrendiği LWW ile birbirini ezerdi.
 *    Yarı ömür uzun (180 gün) → liste zamanla ne istediğini UNUTMAZ.
 */
export interface PlaylistStyle {
  /** Keşfet filtre kimlikleri (lib/filters.ts). */
  filters: string[];
  /** Serbest tarzlar ("drift phonk") — YT Music'te o adla liste aranır. */
  styles: string[];
  /** Açıkken bu listeyi dinlemek genel zevke yalnız %20 işler. */
  isolate: boolean;
}

export interface PlaylistTaste {
  /** küçük harf sanatçı → öğrenilen puan (−6..+6). */
  artists: Map<string, number>;
  /** Bu listede tekrar tekrar geçilen parçalar — bir daha önerme. */
  skippedTracks: Set<string>;
  /** Listenin dil/yazı dağılımı (0..1). */
  scripts: Map<TitleScript, number>;
  medianDurationMs: number;
}

const DEFAULT_STYLE: PlaylistStyle = { filters: [], styles: [], isolate: true };
const TASTE_HALF_LIFE_DAYS = 180;
const SCORE_CAP = 6;
const MEMBER_SCORE = 0.25;
const VOTE_SCORE = 2;
const TASTE_TTL_MS = 60_000;

/** Bellek kopyası: `recordOutgoing` EŞZAMANLI, DB'yi bekleyemez. */
const styles = new Map<string, PlaylistStyle>();
const tastes = new Map<string, { at: number; taste: PlaylistTaste }>();

function parseStyle(raw: string | null | undefined): PlaylistStyle {
  if (!raw) return { ...DEFAULT_STYLE };
  try {
    const p = JSON.parse(raw) as Partial<PlaylistStyle>;
    return {
      filters: Array.isArray(p.filters) ? p.filters : [],
      styles: Array.isArray(p.styles) ? p.styles : [],
      isolate: p.isolate !== false,
    };
  } catch {
    return { ...DEFAULT_STYLE };
  }
}

/** Açılışta ve uzaktan değişiklik gelince çağrılır. */
export async function loadPlaylistStyles(): Promise<void> {
  if (!isTauri()) return;
  try {
    const db = await getDb();
    const rows = await db.select<{ id: string; style_json: string | null }[]>(
      `SELECT id, style_json FROM playlists WHERE deleted = 0`
    );
    styles.clear();
    for (const r of rows) styles.set(r.id, parseStyle(r.style_json));
  } catch (e) {
    console.error("[resonance] liste tarzları yüklenemedi:", e);
  }
}

export function getPlaylistStyle(id: string): PlaylistStyle {
  return styles.get(id) ?? { ...DEFAULT_STYLE };
}

export async function setPlaylistStyle(
  id: string,
  style: PlaylistStyle
): Promise<void> {
  styles.set(id, style);
  const db = await getDb();
  await db.execute(
    `UPDATE playlists SET style_json = $1, updated_at = $2 WHERE id = $3`,
    [JSON.stringify(style), Date.now(), id]
  );
  notifyLocalChange();
}

/** Listeye bir tarz atanmış mı (filtre ya da serbest tarz)? */
export function hasStyle(s: PlaylistStyle): boolean {
  return s.filters.length > 0 || s.styles.length > 0;
}

/** Gerçek (kullanıcı) liste mi? Keşfet, akıllı listeler ve sanal kaynaklar değil. */
export function isRealPlaylist(id: string | null | undefined): id is string {
  return !!id && !id.startsWith("__") && !id.includes(":");
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Listenin öğrendiklerini geçmişten türetir (1 dk önbellekli). */
export async function buildPlaylistTaste(id: string): Promise<PlaylistTaste> {
  const hit = tastes.get(id);
  if (hit && Date.now() - hit.at < TASTE_TTL_MS) return hit.taste;

  const db = await getDb();
  const now = Date.now();
  const [members, plays, votes] = await Promise.all([
    db.select<{ title: string; artist: string; duration_ms: number }[]>(
      `SELECT t.title, t.artist, t.duration_ms
       FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = $1 AND pt.deleted = 0 AND t.title <> ''`,
      [id]
    ),
    db.select<
      {
        track_id: string;
        ms_played: number;
        played_at: number;
        title: string;
        artist: string;
        duration_ms: number;
      }[]
    >(
      `SELECT h.track_id, h.ms_played, h.played_at, t.title, t.artist, t.duration_ms
       FROM play_history h JOIN tracks t ON t.id = h.track_id
       WHERE h.playlist_id = $1`,
      [id]
    ),
    db.select<{ value: number; created_at: number; artist: string }[]>(
      `SELECT v.value, v.created_at, t.artist
       FROM votes v JOIN tracks t ON t.id = v.track_id
       WHERE v.playlist_id = $1 AND v.deleted = 0`,
      [id]
    ),
  ]);

  const artists = new Map<string, number>();
  const add = (artist: string, delta: number) => {
    const k = artist.trim().toLowerCase();
    if (k) artists.set(k, (artists.get(k) ?? 0) + delta);
  };
  for (const m of members) add(m.artist, MEMBER_SCORE);

  const trackStats = new Map<string, { skips: number; completes: number }>();
  const scriptCounts = new Map<TitleScript, number>();
  const countScript = (title: string) => {
    const s = titleScript(title);
    scriptCounts.set(s, (scriptCounts.get(s) ?? 0) + 1);
  };
  const durations = members.map((m) => m.duration_ms).filter((d) => d > 0);
  for (const m of members) countScript(m.title);

  for (const p of plays) {
    const decay = decayWeight(now - p.played_at, TASTE_HALF_LIFE_DAYS);
    const st = trackStats.get(p.track_id) ?? { skips: 0, completes: 0 };
    if (isComplete(p.ms_played, p.duration_ms)) {
      add(p.artist, decay);
      st.completes += 1;
      // Sonuna kadar dinlenen öneri, listeye eklenmese de listenin tarzıdır.
      countScript(p.title);
      if (p.duration_ms > 0) durations.push(p.duration_ms);
    } else if (isSkip(p.ms_played, p.duration_ms)) {
      add(p.artist, -decay);
      st.skips += 1;
    } else if (listenRatio(p.ms_played, p.duration_ms) > 0.4) {
      add(p.artist, 0.3 * decay);
    }
    trackStats.set(p.track_id, st);
  }
  for (const v of votes) {
    add(
      v.artist,
      VOTE_SCORE * v.value * decayWeight(now - v.created_at, TASTE_HALF_LIFE_DAYS)
    );
  }

  for (const [k, v] of artists) {
    artists.set(k, Math.max(-SCORE_CAP, Math.min(SCORE_CAP, v)));
  }
  const skippedTracks = new Set<string>();
  for (const [trackId, st] of trackStats) {
    if (st.skips >= 2 && st.completes === 0) skippedTracks.add(trackId);
  }
  const totalScripts = [...scriptCounts.values()].reduce((a, b) => a + b, 0);
  const scripts = new Map<TitleScript, number>();
  for (const [s, c] of scriptCounts) scripts.set(s, c / totalScripts);

  const taste: PlaylistTaste = {
    artists,
    skippedTracks,
    scripts,
    medianDurationMs: median(durations),
  };
  tastes.set(id, { at: now, taste });
  return taste;
}

export function artistScore(taste: PlaylistTaste, artist: string): number {
  return taste.artists.get(artist.trim().toLowerCase()) ?? 0;
}

/** Öğrenilen puan → ağırlık (−6..+6 → ~0.1..8). */
export function learnedWeight(taste: PlaylistTaste, artist: string): number {
  return Math.exp(0.35 * artistScore(taste, artist));
}

/** Aday bu listeye ne kadar uyuyor (sanatçı × dil × süre). */
export function candidateFit(
  taste: PlaylistTaste,
  c: { title: string; artist: string; durationMs: number }
): number {
  return (
    learnedWeight(taste, c.artist) *
    scriptFit(taste.scripts, c.title) *
    durationFit(taste.medianDurationMs, c.durationMs)
  );
}

/** Listeden geçilen dinleme hemen sonraki beslemede de görülsün. */
export function invalidatePlaylistTaste(id: string): void {
  tastes.delete(id);
}
