import { useEffect } from "react";
import { Library, ListMusic, HardDriveDownload, Plus } from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useLibraryStore } from "../store/useLibraryStore";
import { useAppStore } from "../store/useAppStore";

export default function LibraryView() {
  const playlists = usePlaylistStore((s) => s.playlists);
  const createPlaylist = usePlaylistStore((s) => s.create);
  const refreshPlaylists = usePlaylistStore((s) => s.refresh);
  const downloads = useLibraryStore((s) => s.downloads);
  const refreshLibrary = useLibraryStore((s) => s.refresh);
  const navigate = useAppStore((s) => s.navigate);

  useEffect(() => {
    refreshPlaylists();
    refreshLibrary();
  }, [refreshPlaylists, refreshLibrary]);

  async function handleCreate() {
    const p = await createPlaylist("Yeni Liste");
    if (p) navigate("playlist", p.id);
  }

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title="Kütüphane"
        subtitle="Çalma listelerin ve indirdiklerin."
      >
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-sm font-medium text-text hover:bg-surface-3"
        >
          <Plus size={16} /> Yeni liste
        </button>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {/* İndirilenler kartı */}
          <button
            onClick={() => navigate("downloads")}
            className="group flex flex-col gap-3 rounded-lg border border-border bg-surface/50 p-4 text-left transition-colors hover:border-border-strong hover:bg-surface"
          >
            <div className="grid h-12 w-12 place-items-center rounded-md bg-up/15 text-up">
              <HardDriveDownload size={22} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">İndirilenler</div>
              <div className="text-xs text-muted">{downloads.length} şarkı</div>
            </div>
          </button>

          {/* Çalma listeleri */}
          {playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => navigate("playlist", pl.id)}
              className="group flex flex-col gap-3 rounded-lg border border-border bg-surface/50 p-4 text-left transition-colors hover:border-border-strong hover:bg-surface"
            >
              <div className="grid h-12 w-12 place-items-center rounded-md bg-accent/15 text-accent">
                <ListMusic size={22} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{pl.name}</div>
                <div className="text-xs text-muted">
                  {pl.trackCount ?? 0} şarkı
                  {pl.source && pl.source !== "local"
                    ? ` · ${pl.source === "spotify" ? "Spotify" : "YT Music"}`
                    : ""}
                </div>
              </div>
            </button>
          ))}
        </div>

        {playlists.length === 0 && (
          <div className="mt-10 flex flex-col items-center justify-center gap-3 py-10 text-faint">
            <Library size={36} strokeWidth={1.5} />
            <p className="max-w-sm text-center text-sm leading-relaxed">
              Henüz çalma listen yok. "Yeni liste" ile oluştur ya da İçe Aktar'dan
              Spotify / YouTube Music listesi getir.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
