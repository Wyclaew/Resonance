import { create } from "zustand";
import type { ViewId } from "../types";

// Gezinme / genel UI durumu. Oynatıcı durumu ayrı bir store'da (M1).
interface AppState {
  view: ViewId;
  activePlaylistId: string | null;
  sidebarCollapsed: boolean;

  navigate: (view: ViewId, playlistId?: string | null) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "now",
  activePlaylistId: null,
  sidebarCollapsed: false,

  navigate: (view, playlistId = null) =>
    set({ view, activePlaylistId: playlistId }),
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
