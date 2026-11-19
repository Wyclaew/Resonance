import { useState, useRef, useEffect } from "react";
import Popover from "./Popover";
import { Moon } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { useT } from "../lib/i18n";

const OPTIONS = [15, 30, 45, 60, 90];

export default function SleepTimerButton() {
  const t = useT();
  const sleepEndsAt = usePlayerStore((s) => s.sleepTimerEndsAt);
  const afterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = sleepEndsAt != null;

  const remainingMin = useSleepRemaining(sleepEndsAt);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={t("sleep.title")}
        className={`flex items-center gap-1 ${
          active || afterTrack ? "text-accent" : "text-muted hover:text-text"
        }`}
      >
        <Moon size={16} />
        {active && <span className="tnum text-[10px] font-medium">{remainingMin}</span>}
      </button>

      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="up" width={170}>
        <SleepTimerOptions onDone={() => setOpen(false)} />
      </Popover>
    </div>
  );
}

/**
 * Uyku seçenekleri — hem tek başına düğmenin açılır menüsü hem alt barın
 * "⋯" menüsündeki alt sayfa bunu kullanır (tek kaynak).
 */
export function SleepTimerOptions({ onDone }: { onDone: () => void }) {
  const t = useT();
  const sleepEndsAt = usePlayerStore((s) => s.sleepTimerEndsAt);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const afterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const setSleepAfterTrack = usePlayerStore((s) => s.setSleepAfterTrack);
  const remainingMin = useSleepRemaining(sleepEndsAt);
  const active = sleepEndsAt != null;
  return (
    <>
          {active && (
            <button
              onClick={() => {
                setSleepTimer(null);
                onDone();
              }}
              className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-sm text-muted hover:bg-surface-3"
            >
              <span>{t("sleep.remaining", { n: remainingMin })}</span>
              <span className="text-down">{t("common.cancel")}</span>
            </button>
          )}
          {afterTrack && (
            <button
              onClick={() => {
                setSleepAfterTrack(false);
                onDone();
              }}
              className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-sm text-accent hover:bg-surface-3"
            >
              <span>{t("sleep.afterTrack")}</span>
              <span className="text-down">{t("common.cancel")}</span>
            </button>
          )}
          {(active || afterTrack) && <div className="my-1 h-px bg-border" />}
          {/* ⭐ "Şarkı bitince dur": süreye değil PARÇAYA bağlı uyku —
              dinlediğin şarkı yarıda kesilmesin. */}
          {!afterTrack && (
            <button
              onClick={() => {
                setSleepAfterTrack(true);
                onDone();
              }}
              className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-muted hover:bg-surface-3 hover:text-text"
            >
              {t("sleep.afterTrack")}
            </button>
          )}
          {OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => {
                setSleepTimer(m);
                onDone();
              }}
              className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-muted hover:bg-surface-3 hover:text-text"
            >
              {t("sleep.minutes", { n: m })}
            </button>
          ))}
    </>
  );
}

/** Kalan dakika (saniyede bir tazelenir). */
export function useSleepRemaining(sleepEndsAt: number | null): number {
  const [now, setNow] = useState(Date.now());
  const active = sleepEndsAt != null;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active ? Math.max(0, Math.ceil(((sleepEndsAt as number) - now) / 60000)) : 0;
}
