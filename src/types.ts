// Resonance — çekirdek alan tipleri.
// Bu tipler hem arayüz hem de SQLite şemasıyla hizalıdır (src-tauri migrations).

export type TrackSource = "youtube" | "local";

export interface Track {
  id: string; // dahili kimlik (source:source_id)
  source: TrackSource;
  sourceId: string; // ör. YouTube video id
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  thumbnail?: string;
  addedAt?: number; // epoch ms
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  source?: "local" | "spotify" | "ytmusic";
  sourceUrl?: string;
  createdAt: number;
  trackCount?: number;
}

export interface PlaylistTrack extends Track {
  position: number;
  karma: number; // net oy (upvote - downvote), decay uygulanmış
  myVote: -1 | 0 | 1; // bu şarkıya verdiğim güncel oy
}

export type Vote = -1 | 0 | 1;

// Oynatma kuyruğundaki bir öğe
export interface QueueItem extends Track {
  // kuyruk içindeki benzersiz örnek kimliği (aynı şarkı iki kez olabilir)
  uid: string;
  playlistId?: string;
}

export type RepeatMode = "off" | "all" | "one";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused";

// Sol menüdeki ana görünümler
export type ViewId =
  | "now" // "Şu An" — algoritmanın önerdiği
  | "search"
  | "library"
  | "downloads"
  | "playlist"
  | "import"
  | "settings";

// İndirme durumu (UI göstergeleri için)
export type DownloadState = "none" | "downloading" | "downloaded";
