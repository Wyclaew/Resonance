import { Music2 } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { formatMs } from "../lib/format";

// Ambiyans / ekran koruyucu — uzun süre etkileşim olmayınca devreye girer.
// Yalnızca çalan şarkıyı sade biçimde gösterir; herhangi bir hareket/tuş ile
// kapanır (kapatma App.tsx'teki idle dinleyicisinde yapılır).
export default function Screensaver() {
  const current = usePlayerStore((s) => s.current);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const pct = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[100] flex select-none flex-col items-center justify-center gap-7 bg-bg animate-fade-in">
      {current ? (
        <>
          <div className="grid h-64 w-64 place-items-center overflow-hidden rounded-3xl bg-surface-3 text-faint shadow-2xl shadow-black/50 ring-1 ring-white/10">
            {current.thumbnail ? (
              <img
                src={current.thumbnail}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <Music2 size={64} />
            )}
          </div>
          <div className="max-w-lg px-6 text-center">
            <div className="truncate text-2xl font-semibold text-text">
              {current.title}
            </div>
            <div className="mt-1 truncate text-base text-muted">
              {current.artist}
            </div>
          </div>
          <div className="flex w-80 items-center gap-3">
            <span className="tnum text-xs text-faint">
              {formatMs(positionMs)}
            </span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tnum text-xs text-faint">
              {formatMs(durationMs)}
            </span>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 text-faint">
          <div className="text-5xl font-semibold text-accent">◈</div>
          <div className="text-lg">Resonance</div>
        </div>
      )}
      <div className="absolute bottom-10 text-xs text-faint">
        Devam etmek için hareket et
      </div>
    </div>
  );
}
