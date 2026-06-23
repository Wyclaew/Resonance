import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../types";
import { isTauri } from "../lib/db";
import * as lib from "../lib/library";
import { useSettingsStore } from "./useSettingsStore";

// İndirilenler kütüphanesi. downloadedIds hızlı arama için (ikon göstergesi),
// downloads listesi "İndirilenler" görünümü için.
interface LibraryState {
  downloadedIds: Set<string>;
  downloads: Track[];
  downloadingIds: Set<string>;
  ready: boolean;

  refresh: () => Promise<void>;
  download: (track: Track) => Promise<void>;
  downloadMany: (
    tracks: Track[],
    onProgress?: (done: number, total: number) => void
  ) => Promise<void>;
  remove: (track: Track) => Promise<void>;
  isDownloaded: (id: string) => boolean;
  isDownloading: (id: string) => boolean;
}

interface DownloadResult {
  path: string;
  bytes: number;
  format: string;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  downloadedIds: new Set(),
  downloads: [],
  downloadingIds: new Set(),
  ready: false,

  refresh: async () => {
    if (!isTauri()) return;
    try {
      const [ids, downloads] = await Promise.all([
        lib.getDownloadedIds(),
        lib.listDownloads(),
      ]);
      set({ downloadedIds: new Set(ids), downloads, ready: true });
    } catch (e) {
      console.error("[resonance] indirilenler yüklenemedi:", e);
    }
  },

  download: async (track) => {
    if (!isTauri()) return;
    const { downloadingIds, downloadedIds } = get();
    if (downloadedIds.has(track.id) || downloadingIds.has(track.id)) return;

    set({ downloadingIds: new Set(downloadingIds).add(track.id) });
    try {
      const file = await invoke<DownloadResult>("download_audio", {
        sourceId: track.sourceId,
        cookiesBrowser: useSettingsStore.getState().cookiesBrowser,
      });
      await lib.addDownload(track, file);
      set((s) => {
        const ids = new Set(s.downloadedIds).add(track.id);
        const dTo = new Set(s.downloadingIds);
        dTo.delete(track.id);
        const downloads = [track, ...s.downloads.filter((t) => t.id !== track.id)];
        return { downloadedIds: ids, downloadingIds: dTo, downloads };
      });
    } catch (e) {
      console.error("[resonance] indirme hatası:", e);
      set((s) => {
        const dTo = new Set(s.downloadingIds);
        dTo.delete(track.id);
        return { downloadingIds: dTo };
      });
    }
  },

  // Toplu indirme: yalnızca indirilmemiş şarkıları, sınırlı eşzamanlılıkla indirir.
  downloadMany: async (tracks, onProgress) => {
    if (!isTauri()) return;
    const todo = tracks.filter(
      (t) => !get().downloadedIds.has(t.id) && !get().downloadingIds.has(t.id)
    );
    const total = todo.length;
    let done = 0;
    onProgress?.(0, total);
    if (total === 0) return;

    const CONCURRENCY = 3;
    let idx = 0;
    const worker = async () => {
      while (idx < todo.length) {
        const t = todo[idx++];
        await get().download(t);
        done++;
        onProgress?.(done, total);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, worker)
    );
  },

  remove: async (track) => {
    if (!isTauri()) return;
    try {
      await lib.removeDownload(track.id);
      await invoke("delete_audio", { sourceId: track.sourceId }).catch(() => {});
      set((s) => {
        const ids = new Set(s.downloadedIds);
        ids.delete(track.id);
        return {
          downloadedIds: ids,
          downloads: s.downloads.filter((t) => t.id !== track.id),
        };
      });
    } catch (e) {
      console.error("[resonance] indirme silme hatası:", e);
    }
  },

  isDownloaded: (id) => get().downloadedIds.has(id),
  isDownloading: (id) => get().downloadingIds.has(id),
}));
