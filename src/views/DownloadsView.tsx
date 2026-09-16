import { useEffect, useRef } from "react";
import { HardDriveDownload } from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import { useAppStore } from "../store/useAppStore";
import { useWindowedList } from "../lib/useWindowedList";
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
  const navigate = useAppStore((s) => s.navigate);
  const scrollRef = useRef<HTMLDivElement>(null);
  const win = useWindowedList(scrollRef, downloads.length);

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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {downloads.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border px-6 py-16">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-accent/10 text-accent">
              <HardDriveDownload size={26} strokeWidth={1.5} />
            </div>
            <p className="max-w-sm text-center text-sm leading-relaxed text-muted">
              {t("downloads.emptyState")}
            </p>
            <button
              onClick={() => navigate("search")}
              className="rounded-full bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface-3"
            >
              {t("nav.search")}
            </button>
          </div>
        ) : (
          <>
            {win.padTop > 0 && <div style={{ height: win.padTop }} />}
            {downloads.slice(win.start, win.end).map((t, idx) => {
              const i = win.start + idx;
              return (
            <TrackRow
              key={t.id}
              track={t}
              index={i}
              isCurrent={current?.id === t.id}
              isPlaying={status === "playing"}
              isLoading={status === "loading"}
              onPlay={() => playNow(t, downloads)}
            />
              );
            })}
            {win.padBottom > 0 && <div style={{ height: win.padBottom }} />}
          </>
        )}
      </div>
    </div>
  );
}
