import type { Track } from "../types";

// Playlist paylaşımı — backend yok: liste, taşınabilir bir koda gömülür.
// Kod "RSNC1:" öneki + base64(JSON). Alıcı uygulamada içe aktarır.

const PREFIX = "RSNC1:";

interface SharePayload {
  v: 1;
  name: string;
  tracks: { t: string; a: string; s: string; sid: string; d: number; th?: string }[];
}

// Unicode-güvenli base64.
function b64encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function b64decode(s: string): string {
  return decodeURIComponent(escape(atob(s)));
}

export function encodePlaylist(name: string, tracks: Track[]): string {
  const payload: SharePayload = {
    v: 1,
    name,
    tracks: tracks.map((t) => ({
      t: t.title,
      a: t.artist,
      s: t.source,
      sid: t.sourceId,
      d: t.durationMs,
      th: t.thumbnail,
    })),
  };
  return PREFIX + b64encode(JSON.stringify(payload));
}

export function isShareCode(text: string): boolean {
  return text.trim().startsWith(PREFIX);
}

export function decodePlaylist(
  code: string
): { name: string; tracks: Track[] } | null {
  try {
    const body = code.trim().slice(PREFIX.length);
    const payload = JSON.parse(b64decode(body)) as SharePayload;
    if (payload.v !== 1 || !Array.isArray(payload.tracks)) return null;
    const tracks: Track[] = payload.tracks.map((x) => ({
      id: `${x.s}:${x.sid}`,
      source: x.s as Track["source"],
      sourceId: x.sid,
      title: x.t,
      artist: x.a,
      durationMs: x.d,
      thumbnail: x.th,
    }));
    return { name: payload.name, tracks };
  } catch {
    return null;
  }
}
