import { useEffect } from "react";
import { HardDriveDownload } from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import TrackRow from "../components/TrackRow";
import { useLibraryStore } from "../store/useLibraryStore";
import { useT } from "../lib/i18n";
import { usePlayerStore } from "../store/usePlayerStore";

export default function DownloadsView() {
  const t = useT();
  const downloads = useLibraryStore((s) => s.downloads);
  const refresh = useLibraryStore((s) => s.refresh);

  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const playNow = usePlayerStore((s) => s.playNow);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title={t("downloads.title")}
        subtitle={
          downloads.length > 0
            ? t("downloads.count", { count: downloads.length })
            : t("downloads.subtitle")
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {downloads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-faint">
            <HardDriveDownload size={40} strokeWidth={1.5} />
            <p className="max-w-sm text-center text-sm leading-relaxed">
              {t("downloads.emptyState")}
            </p>
          </div>
        ) : (
          downloads.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              index={i}
              isCurrent={current?.id === t.id}
              isPlaying={status === "playing"}
              isLoading={status === "loading"}
              onPlay={() => playNow(t, downloads)}
            />
          ))
        )}
      </div>
    </div>
  );
}
