import { useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ListMusic,
  Moon,
  MonitorSmartphone,
  MoreHorizontal,
  PictureInPicture2,
  ScrollText,
} from "lucide-react";
import Popover from "./Popover";
import { SleepTimerOptions, useSleepRemaining } from "./SleepTimerButton";
import { HandoffOptions } from "./HandoffButton";
import { useT } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { toggleMiniPlayer } from "../lib/miniPlayer";
import { isSyncConfigured } from "../lib/sync/config";
import { listHandoffTargets, type HandoffTarget } from "../lib/remote";

type Page = "main" | "sleep" | "handoff";

/**
 * Alt barın sağındaki "⋯" menüsü (v1.9.9). Kullanıcı: "indirme ve ses hariç
 * diğerlerini bir menüye topla, çok karışık görünüyor, çoğunu kullanmıyorum."
 * Uyku ve cihaz aktarma ayrı açılır menü yerine BU menünün alt sayfasıdır —
 * iç içe iki açılır menü, dışına tıklama kuralıyla birbirini kapatıyordu.
 * Bir şey açıksa (sözler, sıra, uyku) düğmede nokta görünür.
 */
export default function PlayerMoreMenu({ showQueue }: { showQueue: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>("main");
  const [targets, setTargets] = useState<HandoffTarget[] | null>(null);
  const lyricsOpen = useAppStore((s) => s.lyricsOpen);
  const toggleLyrics = useAppStore((s) => s.toggleLyrics);
  const queueOpen = useAppStore((s) => s.queueOpen);
  const toggleQueue = useAppStore((s) => s.toggleQueue);
  const sleepEndsAt = usePlayerStore((s) => s.sleepTimerEndsAt);
  const afterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const remainingMin = useSleepRemaining(sleepEndsAt);
  const sleepActive = sleepEndsAt != null || afterTrack;
  const anyActive = lyricsOpen || (showQueue && queueOpen) || sleepActive;

  const close = () => {
    setOpen(false);
    setPage("main");
  };
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  const item = (
    icon: ReactNode,
    label: string,
    onClick: () => void,
    opts: { active?: boolean; trailing?: ReactNode } = {}
  ) => (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm hover:bg-surface-3 ${
        opts.active ? "text-accent" : "text-muted hover:text-text"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {opts.trailing}
    </button>
  );

  const back = (title: string) => (
    <button
      onClick={() => setPage("main")}
      className="mb-1 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs font-medium text-faint hover:text-text"
    >
      <ChevronLeft size={14} />
      {title}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => (open ? close() : setOpen(true))}
        title={t("player.more")}
        className={`relative grid h-8 w-8 place-items-center rounded-md transition-colors hover:text-text ${
          open ? "text-text" : "text-muted"
        }`}
      >
        <MoreHorizontal size={18} />
        {anyActive && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
        )}
      </button>
      <Popover anchor={ref} open={open} onClose={close} placement="up" align="end" width={240}>
        {page === "main" && (
          <>
            {showQueue &&
              item(<ListMusic size={15} />, t("player.queue"), run(toggleQueue), {
                active: queueOpen,
              })}
            {item(<ScrollText size={15} />, t("player.lyrics"), run(toggleLyrics), {
              active: lyricsOpen,
            })}
            {item(
              <PictureInPicture2 size={15} />,
              t("player.miniPlayer"),
              run(() => void toggleMiniPlayer())
            )}
            <div className="my-1 h-px bg-border" />
            {item(<Moon size={15} />, t("sleep.title"), () => setPage("sleep"), {
              active: sleepActive,
              trailing: (
                <span className="flex items-center gap-1 text-[11px] text-faint">
                  {sleepEndsAt != null && t("sleep.remaining", { n: remainingMin })}
                  <ChevronRight size={14} />
                </span>
              ),
            })}
            {isSyncConfigured() &&
              item(
                <MonitorSmartphone size={15} />,
                t("remote.handoffTitle"),
                () => {
                  setTargets(null);
                  setPage("handoff");
                  void listHandoffTargets().then(setTargets);
                },
                { trailing: <ChevronRight size={14} className="text-faint" /> }
              )}
          </>
        )}
        {page === "sleep" && (
          <>
            {back(t("sleep.title"))}
            <SleepTimerOptions onDone={close} />
          </>
        )}
        {page === "handoff" && (
          <>
            {back(t("remote.handoffTitle"))}
            <HandoffOptions targets={targets} onDone={close} />
          </>
        )}
      </Popover>
    </div>
  );
}
