import { useState, useRef, useEffect } from "react";
import { Moon } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { useT } from "../lib/i18n";

const OPTIONS = [15, 30, 45, 60, 90];

export default function SleepTimerButton() {
  const t = useT();
  const sleepEndsAt = usePlayerStore((s) => s.sleepTimerEndsAt);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const active = sleepEndsAt != null;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const remainingMin = active
    ? Math.max(0, Math.ceil(((sleepEndsAt as number) - now) / 60000))
    : 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={t("sleep.title")}
        className={`flex items-center gap-1 ${
          active ? "text-accent" : "text-muted hover:text-text"
        }`}
      >
        <Moon size={16} />
        {active && <span className="tnum text-[10px] font-medium">{remainingMin}</span>}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-40 rounded-md border border-border bg-surface-2 p-1 shadow-2xl">
          {active && (
            <button
              onClick={() => {
                setSleepTimer(null);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-sm text-muted hover:bg-surface-3"
            >
              <span>{t("sleep.remaining", { n: remainingMin })}</span>
              <span className="text-down">{t("common.cancel")}</span>
            </button>
          )}
          {active && <div className="my-1 h-px bg-border" />}
          {OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => {
                setSleepTimer(m);
                setOpen(false);
              }}
              className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-muted hover:bg-surface-3 hover:text-text"
            >
              {t("sleep.minutes", { n: m })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
