// Resonance — çekirdek alan tipleri.
// Bu tipler hem arayüz hem de SQLite şemasıyla hizalıdır (src-tauri migrations).

export type TrackSource = "youtube" | "local";

// Öneri gerekçesi — YAPISAL (string değil). Dil sonradan değişince metin de
// değişsin diye anahtar+parametre olarak saklanır; render anında çevrilir
// (recommender.ts reasonText). dow = gün sayısı (0..6), gün adı render'da üretilir.
export interface RecReason {
  key: "rec.newDiscovery" | "rec.contextual" | "rec.favorite" | "rec.fromPlaylist";
  seed?: string;
  artist?: string;
  dow?: number;
}

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
  karma: number; // biriken decay'li oy skoru (her up +1, down -1)
  myVote: -1 | 0 | 1; // en son verdiğim oyun yönü (UI ipucu)
  lastVoteAt?: number; // bu şarkıya bu listede son oy zamanı (cooldown için)
}

export type Vote = -1 | 0 | 1;

// Oynatma kuyruğundaki bir öğe
export interface QueueItem extends Track {
  // kuyruk içindeki benzersiz örnek kimliği (aynı şarkı iki kez olabilir)
  uid: string;
  playlistId?: string;
  // Resonance önerisi olarak araya eklendiyse:
  isRecommendation?: boolean;
  recSource?: "youtube" | "library";
  recReason?: RecReason;
  /** Bu öneriyi getiren radyonun seed sanatçısı — oturum modu bunu "tarz"
   *  vekili olarak kullanır (lib/mood.ts). */
  seedArtist?: string;
  /** "Modun değişti mi?" denemesi: bilerek farklı tarzdan seçilmiş parça. */
  isProbe?: boolean;
}

export type RepeatMode = "off" | "all" | "one";

// Karışık çalma modu:
//  • "off"     → kuyruk sırasıyla
//  • "shuffle" → rastgele sonraki (klasik karışık)
//  • "smart"   → karışık + Resonance önerileri araya serpiştirilir (akıllı karışık)
export type ShuffleMode = "off" | "shuffle" | "smart";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused";

// Sol menüdeki ana görünümler
export type ViewId =
  | "now" // "Şu An" — algoritmanın önerdiği
  | "discover" // Keşfet — kendi sayfası (v1.3.0; eskiden sıra paneliydi)
  | "search"
  | "library"
  | "downloads"
  | "playlist"
  | "import"
  | "stats" // Dinleme etkinliği & analiz (profil menüsünden)
  | "account" // Hesap & senkron (profil menüsünden; Ayarlar'dan çıkarıldı)
  | "settings";

// İndirme durumu (UI göstergeleri için)
export type DownloadState = "none" | "downloading" | "downloaded";
