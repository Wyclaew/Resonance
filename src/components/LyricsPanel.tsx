import { useState, useEffect, useRef } from "react";
import { X, Loader2, Music4 } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { useAppStore } from "../store/useAppStore";
import { fetchLyrics, type LrcLine } from "../lib/lyrics";

function findActive(lines: LrcLine[], posMs: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= posMs + 250) idx = i;
    else break;
  }
  return idx;
}

export default function LyricsPanel() {
  const current = usePlayerStore((s) => s.current);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const seek = usePlayerStore((s) => s.seek);
  const toggleLyrics = useAppStore((s) => s.toggleLyrics);

  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState<LrcLine[] | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!current) {
      setSynced(null);
      setPlain(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSynced(null);
    setPlain(null);
    fetchLyrics(current.artist, current.title, current.durationMs)
      .then((r) => {
        if (cancelled) return;
        setSynced(r.synced);
        setPlain(r.plain);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [current?.id]);

  const activeIdx = synced ? findActive(synced, positionMs) : -1;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg/95 backdrop-blur-sm">
      <header className="flex items-start justify-between px-8 pb-3 pt-6">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            {current?.title ?? "Sözler"}
          </h2>
          <p className="truncate text-sm text-muted">{current?.artist}</p>
        </div>
        <button
          onClick={toggleLyrics}
          title="Kapat"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-text"
        >
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16 pt-6">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-24 text-faint">
            <Loader2 size={28} className="animate-spin text-accent" />
            <span className="text-sm">Sözler aranıyor…</span>
          </div>
        ) : synced ? (
          <div className="mx-auto max-w-2xl text-center">
            {synced.map((l, i) => (
              <div
                key={i}
                ref={i === activeIdx ? activeRef : undefined}
                onClick={() => seek(l.timeMs)}
                className={`cursor-pointer py-2.5 text-2xl font-semibold leading-snug transition-colors ${
                  i === activeIdx
                    ? "text-text"
                    : "text-faint hover:text-muted"
                }`}
              >
                {l.text || "♪"}
              </div>
            ))}
          </div>
        ) : plain ? (
          <div className="mx-auto max-w-2xl whitespace-pre-wrap text-lg leading-relaxed text-muted">
            {plain}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-24 text-faint">
            <Music4 size={32} strokeWidth={1.5} />
            <p className="text-sm">
              {current
                ? "Bu şarkı için söz bulunamadı."
                : "Çalan bir şarkı yok."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
