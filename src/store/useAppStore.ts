import { create } from "zustand";
import type { ViewId } from "../types";

// Gezinme / genel UI durumu. Oynatıcı durumu ayrı bir store'da (M1).
interface AppState {
  view: ViewId;
  activePlaylistId: string | null;
  sidebarCollapsed: boolean;
  lyricsOpen: boolean;
  queueOpen: boolean;
  commandOpen: boolean;
  idle: boolean; // ekran koruyucu aktif mi (arka plan işleri kısılır)
  backgrounded: boolean; // pencere odağı kaybettti mi (GPU/CPU tasarrufu)

  navigate: (view: ViewId, playlistId?: string | null) => void;
  toggleSidebar: () => void;
  toggleLyrics: () => void;
  toggleQueue: () => void;
  setCommand: (open: boolean) => void;
  setIdle: (idle: boolean) => void;
  setBackgrounded: (backgrounded: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "now",
  activePlaylistId: null,
  sidebarCollapsed: false,
  lyricsOpen: false,
  queueOpen: false,
  commandOpen: false,
  idle: false,
  backgrounded: false,

  // Gezinince açık panelleri (sıra/söz/komut) kapat — yeni görünümü örtmesinler.
  navigate: (view, playlistId = null) =>
    set({
      view,
      activePlaylistId: playlistId,
      commandOpen: false,
      queueOpen: false,
      lyricsOpen: false,
    }),
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  // Sözler ve Sıra panelleri aynı yeri kaplar — biri açılınca diğeri kapanır.
  toggleLyrics: () => set((s) => ({ lyricsOpen: !s.lyricsOpen, queueOpen: false })),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen, lyricsOpen: false })),
  setCommand: (open) => set({ commandOpen: open }),
  setIdle: (idle) => set({ idle }),
  setBackgrounded: (backgrounded) => set({ backgrounded }),
}));
