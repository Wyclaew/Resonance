import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "./components/Sidebar";
import NowPlayingBar from "./components/NowPlayingBar";
import LyricsPanel from "./components/LyricsPanel";
import QueuePanel from "./components/QueuePanel";
import CommandPalette from "./components/CommandPalette";
import Toasts from "./components/Toasts";
import { getDb, isTauri } from "./lib/db";
import { initPlayer, usePlayerStore } from "./store/usePlayerStore";
import HomeView from "./views/HomeView";
import SearchView from "./views/SearchView";
import LibraryView from "./views/LibraryView";
import DownloadsView from "./views/DownloadsView";
import PlaylistView from "./views/PlaylistView";
import ImportView from "./views/ImportView";
import SettingsView from "./views/SettingsView";
import { useAppStore } from "./store/useAppStore";
import { useLibraryStore } from "./store/useLibraryStore";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useSettingsStore } from "./store/useSettingsStore";

function CurrentView() {
  const view = useAppStore((s) => s.view);
  const activePlaylistId = useAppStore((s) => s.activePlaylistId);

  switch (view) {
    case "now":
      return <HomeView />;
    case "search":
      return <SearchView />;
    case "library":
      return <LibraryView />;
    case "downloads":
      return <DownloadsView />;
    case "playlist":
      return <PlaylistView playlistId={activePlaylistId} />;
    case "import":
      return <ImportView />;
    case "settings":
      return <SettingsView />;
    default:
      return <HomeView />;
  }
}

export default function App() {
  const accentColor = useSettingsStore((s) => s.accentColor);
  const lyricsOpen = useAppStore((s) => s.lyricsOpen);
  const queueOpen = useAppStore((s) => s.queueOpen);
  const commandOpen = useAppStore((s) => s.commandOpen);
  const view = useAppStore((s) => s.view);
  const activePlaylistId = useAppStore((s) => s.activePlaylistId);

  // DB'yi açılışta başlat (migration'ları tetikler). Tauri dışında atlanır.
  useEffect(() => {
    if (!isTauri()) return;
    getDb()
      .then(async () => {
        console.info("[resonance] veritabanı hazır");
        await Promise.all([
          useLibraryStore.getState().refresh(),
          usePlaylistStore.getState().refresh(),
        ]);
        useSettingsStore
          .getState()
          .load()
          .then(() => {
            const s = useSettingsStore.getState();
            if (s.rememberVolume) usePlayerStore.getState().setVolume(s.savedVolume);
          });
        // Veri varsa otomatik yedek al (kazara kayba karşı güvenlik ağı).
        const hasData =
          usePlaylistStore.getState().playlists.length > 0 ||
          useLibraryStore.getState().downloads.length > 0;
        if (hasData) invoke("backup_db").catch(() => {});
      })
      .catch((e) => console.error("[resonance] veritabanı hatası:", e));
    initPlayer();
  }, []);

  // Vurgu rengini uygula (Görünüm ayarı).
  useEffect(() => {
    document.documentElement.style.setProperty("--color-accent", accentColor);
  }, [accentColor]);

  // Klavye kısayolları (input/textarea dışında).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Komut paleti (Cmd/Ctrl+K) — input içindeyken bile çalışır.
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        const a = useAppStore.getState();
        a.setCommand(!a.commandOpen);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      const p = usePlayerStore.getState();
      switch (e.code) {
        case "Space":
          e.preventDefault();
          p.toggle();
          break;
        case "ArrowRight":
          if (e.shiftKey) p.next();
          else p.seek(Math.min(p.durationMs, p.positionMs + 5000));
          break;
        case "ArrowLeft":
          if (e.shiftKey) p.prev();
          else p.seek(Math.max(0, p.positionMs - 5000));
          break;
        case "ArrowUp":
          e.preventDefault();
          p.setVolume(Math.min(1, p.volume + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          p.setVolume(Math.max(0, p.volume - 0.05));
          break;
        case "KeyM":
          p.toggleMute();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1 overflow-hidden bg-bg">
          {/* view (ve aktif liste) değişince yumuşak fade-in */}
          <div key={`${view}:${activePlaylistId ?? ""}`} className="h-full animate-fade-in">
            <CurrentView />
          </div>
          {lyricsOpen && <LyricsPanel />}
          {queueOpen && <QueuePanel />}
        </main>
      </div>
      <NowPlayingBar />
      {commandOpen && <CommandPalette />}
      <Toasts />
    </div>
  );
}
