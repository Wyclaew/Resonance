import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./db";

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

export async function fetchLyrics(
  artist: string,
  title: string,
  durationMs: number
): Promise<{ synced: LrcLine[] | null; plain: string | null }> {
  if (!isTauri()) return { synced: null, plain: null };
  const res = await invoke<{ synced: string | null; plain: string | null }>(
    "get_lyrics",
    { artist, title, durationMs }
  );
  return {
    synced: res.synced ? parseLrc(res.synced) : null,
    plain: res.plain ?? null,
  };
}
