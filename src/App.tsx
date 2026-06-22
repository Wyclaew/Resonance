import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import NowPlayingBar from "./components/NowPlayingBar";
import { getDb, isTauri } from "./lib/db";
import { initPlayer } from "./store/usePlayerStore";
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
  // DB'yi açılışta başlat (migration'ları tetikler). Tauri dışında atlanır.
  useEffect(() => {
    if (!isTauri()) return;
    getDb()
      .then(() => {
        console.info("[resonance] veritabanı hazır");
        useLibraryStore.getState().refresh();
        usePlaylistStore.getState().refresh();
        useSettingsStore.getState().load();
      })
      .catch((e) => console.error("[resonance] veritabanı hatası:", e));
    initPlayer();
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden bg-bg">
          <CurrentView />
        </main>
      </div>
      <NowPlayingBar />
    </div>
  );
}
