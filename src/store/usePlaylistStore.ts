import { create } from "zustand";
import type { Playlist, Track } from "../types";
import { isTauri } from "../lib/db";
import * as pl from "../lib/playlists";

// Çalma listeleri (sidebar + yönetim). Liste içeriği görünümde ayrı yüklenir.
interface PlaylistState {
  playlists: Playlist[];
  ready: boolean;

  refresh: () => Promise<void>;
  create: (name: string) => Promise<Playlist | null>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addTrack: (playlistId: string, track: Track) => Promise<boolean>;
  removeTrack: (playlistId: string, trackId: string) => Promise<void>;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  ready: false,

  refresh: async () => {
    if (!isTauri()) return;
    try {
      const playlists = await pl.listPlaylists();
      set({ playlists, ready: true });
    } catch (e) {
      console.error("[resonance] çalma listeleri yüklenemedi:", e);
    }
  },

  create: async (name) => {
    if (!isTauri()) return null;
    const p = await pl.createPlaylist(name);
    await get().refresh();
    return p;
  },

  rename: async (id, name) => {
    if (!isTauri()) return;
    await pl.renamePlaylist(id, name);
    await get().refresh();
  },

  remove: async (id) => {
    if (!isTauri()) return;
    await pl.deletePlaylist(id);
    await get().refresh();
  },

  addTrack: async (playlistId, track) => {
    if (!isTauri()) return false;
    const added = await pl.addTrackToPlaylist(playlistId, track);
    await get().refresh(); // şarkı sayısını güncelle
    return added;
  },

  removeTrack: async (playlistId, trackId) => {
    if (!isTauri()) return;
    await pl.removeTrackFromPlaylist(playlistId, trackId);
    await get().refresh();
  },
}));
