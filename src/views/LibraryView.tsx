import { useEffect, useState } from "react";
import { Library, ListMusic, HardDriveDownload, Plus, Sparkles } from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useLibraryStore } from "../store/useLibraryStore";
import { useAppStore } from "../store/useAppStore";
import { useT } from "../lib/i18n";
import { usePlayerStore } from "../store/usePlayerStore";
import { useToastStore } from "../store/useToastStore";
import { SMART_LISTS, runSmartList } from "../lib/smartLists";

// ⭐ AKILLI LİSTELER (v1.8.3): kalıcı playlist satırı YOK — her açılışta
// play_history'den yeniden hesaplanır (bkz. lib/smartLists.ts). Böylece hem
// senkron yükü olmaz hem de liste hep güncel kalır.
function SmartLists() {
  const t = useT();
  const playShuffled = usePlayerStore((s) => s.playShuffled);
  const playNow = usePlayerStore((s) => s.playNow);
  const toast = useToastStore((s) => s.show);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Sayıları önden hesapla ki boş listeler kart olarak görünmesin.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, number> = {};
      for (const l of SMART_LISTS) {
        out[l.id] = (await runSmartList(l.id)).length;
      }
      if (alive) setCounts(out);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const open = async (id: (typeof SMART_LISTS)[number]["id"], shuffle: boolean) => {
    setBusy(id);
    try {
      const tracks = await runSmartList(id);
      if (tracks.length === 0) {
        toast(t("smart.empty"), "info");
        return;
      }
      if (shuffle) playShuffled(tracks, `smart:${id}`);
      else playNow(tracks[0], tracks, `smart:${id}`);
    } finally {
      setBusy(null);
    }
  };

  const visible = SMART_LISTS.filter((l) => (counts[l.id] ?? 0) > 0);
  if (visible.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {t("smart.header")}
      </div>
      <p className="mb-3 text-xs text-muted">{t("smart.headerDesc")}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {visible.map((l) => (
          <button
            key={l.id}
            onClick={() => void open(l.id, true)}
            disabled={busy === l.id}
            className="group flex flex-col gap-3 rounded-lg border border-border bg-surface/50 p-4 text-left transition-colors hover:border-accent/40 hover:bg-surface disabled:opacity-50"
          >
            <div className="grid h-12 w-12 place-items-center rounded-md bg-accent/15 text-accent">
              <Sparkles size={20} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{t(l.labelKey)}</div>
              <div className="truncate text-xs text-muted">{t(l.descKey)}</div>
              <div className="mt-0.5 text-[11px] text-faint">
                {t("smart.count", { n: counts[l.id] ?? 0 })}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function LibraryView() {
  const t = useT();
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
    const p = await createPlaylist(t("library.newList"));
    if (p) navigate("playlist", p.id);
  }

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title={t("library.title")}
        subtitle={t("library.subtitle")}
      >
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-sm font-medium text-text hover:bg-surface-3"
        >
          <Plus size={16} /> {t("library.newList")}
        </button>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        <SmartLists />

        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
          {t("library.title")}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {/* İndirilenler kartı */}
          <button
            onClick={() => navigate("downloads")}
            className="group flex flex-col gap-3 rounded-lg border border-border bg-surface/50 p-4 text-left transition-colors hover:border-accent/40 hover:bg-surface"
          >
            <div className="grid h-12 w-12 place-items-center rounded-md bg-up/15 text-up">
              <HardDriveDownload size={22} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{t("nav.downloads")}</div>
              <div className="text-xs text-muted">{t("playlist.trackCount", { count: downloads.length })}</div>
            </div>
          </button>

          {/* Çalma listeleri */}
          {playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => navigate("playlist", pl.id)}
              className="group flex flex-col gap-3 rounded-lg border border-border bg-surface/50 p-4 text-left transition-colors hover:border-accent/40 hover:bg-surface"
            >
              <div className="grid h-12 w-12 place-items-center rounded-md bg-accent/15 text-accent">
                <ListMusic size={22} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{pl.name}</div>
                <div className="text-xs text-muted">
                  {t("playlist.trackCount", { count: pl.trackCount ?? 0 })}
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
              {t("library.emptyState")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
