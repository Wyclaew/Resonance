import { invoke } from "@tauri-apps/api/core";
import { getDb, isTauri } from "./db";

export interface LrcLine {
  timeMs: number;
  text: string;
}

// [mm:ss.xx] etiketli LRC'yi zaman damgalı satırlara ayrıştırır.
export function parseLrc(lrc: string): LrcLine[] {
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const lines: LrcLine[] = [];
  for (const raw of lrc.split("\n")) {
    const stamps = [...raw.matchAll(re)];
    if (stamps.length === 0) continue;
    const text = raw.replace(re, "").trim();
    for (const s of stamps) {
      const min = Number(s[1]);
      const sec = Number(s[2]);
      const frac = s[3] ? Number(s[3].padEnd(3, "0")) : 0;
      lines.push({ timeMs: min * 60000 + sec * 1000 + frac, text });
    }
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

export interface LyricsResult {
  synced: LrcLine[] | null;
  plain: string | null;
  /** Seçilen söz kaydının süresi (0 = bilinmiyor). */
  lyricsMs: number;
}

/** Bulunamayan (iki alan da boş) sonuç bu süre sonra yeniden denenir. */
const NEG_TTL_MS = 30 * 24 * 3600 * 1000;

interface LyricsRow {
  synced: string | null;
  plain: string | null;
  lyrics_ms: number;
  fetched_at: number;
}

function toResult(r: {
  synced: string | null;
  plain: string | null;
  lyrics_ms: number;
}): LyricsResult {
  return {
    synced: r.synced ? parseLrc(r.synced) : null,
    plain: r.plain ?? null,
    lyricsMs: r.lyrics_ms ?? 0,
  };
}

/**
 * Sözler: önce yerel önbellek (`lyrics_cache`, cihaza özel), yoksa lrclib.
 * Olumlu sonuç sonsuza dek, olumsuz 30 gün saklanır. Önbellek okunamaz/yazılamazsa
 * sözler yine de çalışır (yalnız uyarı).
 */
export async function fetchLyrics(
  trackId: string,
  artist: string,
  title: string,
  durationMs: number
): Promise<LyricsResult> {
  if (!isTauri()) return { synced: null, plain: null, lyricsMs: 0 };
  try {
    const db = await getDb();
    const rows = await db.select<LyricsRow[]>(
      "SELECT synced, plain, lyrics_ms, fetched_at FROM lyrics_cache WHERE track_id = $1",
      [trackId]
    );
    const r = rows[0];
    if (r) {
      const negative = !r.synced && !r.plain;
      if (!negative || Date.now() - r.fetched_at < NEG_TTL_MS) return toResult(r);
    }
  } catch (e) {
    console.warn("[resonance] söz önbelleği okunamadı:", e);
  }
  const res = await invoke<{
    synced: string | null;
    plain: string | null;
    lyrics_ms: number;
  }>("get_lyrics", { artist, title, durationMs });
  try {
    const db = await getDb();
    await db.execute(
      `INSERT INTO lyrics_cache (track_id, synced, plain, lyrics_ms, fetched_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(track_id) DO UPDATE SET synced = excluded.synced,
         plain = excluded.plain, lyrics_ms = excluded.lyrics_ms,
         fetched_at = excluded.fetched_at`,
      [trackId, res.synced ?? null, res.plain ?? null, res.lyrics_ms ?? 0, Date.now()]
    );
  } catch (e) {
    console.warn("[resonance] söz önbelleği yazılamadı:", e);
  }
  return toResult(res);
}

/** Söz kaydı ile çalan sürüm arasında bu kadar fark varsa kullanıcıya söylenir. */
export const VERSION_GAP_MS = 4000;
/** Elle kaydırma adımı ve sınırı. */
export const OFFSET_STEP_MS = 500;
const OFFSET_LIMIT_MS = 60_000;
const OFFSET_KEY = "resonance.lyricsOffset.";

/**
 * Parça başına elle kaydırma (ms, + = sözler daha GEÇ). Cihaza özel: aynı parça
 * başka cihazda farklı kaynaktan inmiş olabilir. localStorage erişilemezse 0.
 */
export function loadLyricsOffset(trackId: string): number {
  try {
    const v = Number(localStorage.getItem(OFFSET_KEY + trackId));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function saveLyricsOffset(trackId: string, ms: number): number {
  const clamped = Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, ms));
  try {
    if (clamped === 0) localStorage.removeItem(OFFSET_KEY + trackId);
    else localStorage.setItem(OFFSET_KEY + trackId, String(clamped));
  } catch (e) {
    console.warn("[resonance] söz kaydırması kaydedilemedi:", e);
  }
  return clamped;
}
