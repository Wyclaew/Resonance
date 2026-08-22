import { useEffect, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Play, Pause, SkipBack, SkipForward, X, Music2 } from "lucide-react";
import { formatMs } from "../lib/format";
import { useT } from "../lib/i18n";

// ═══════════════════════════════════════════════════════════════════════════
// MİNİ OYNATICI — küçük, hep üstte duran ikinci pencere.
//
// ⚠️ AYRI JS BAĞLAMI: bu pencere ana penceredeki zustand store'u GÖREMEZ.
// Durumu Rust'tan yayılan `playback-tick` / `now-playing-meta` olaylarından
// öğrenir; kontrolleri de `mini-command` olayıyla ANA pencereye yollar —
// kuyruk mantığı (öneri besleme, atlama sinyalleri) orada yaşıyor ve
// ikiye bölünmemeli.
// ═══════════════════════════════════════════════════════════════════════════

type Meta = {
  title: string;
  artist: string;
  thumbnail?: string;
};

export default function MiniPlayer() {
  const t = useT();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const unlisten: Array<Promise<() => void>> = [];
    unlisten.push(
      listen<{ position_ms: number; duration_ms: number; playing: boolean }>(
        "playback-tick",
        (e) => {
          setPos(e.payload.position_ms);
          if (e.payload.duration_ms > 0) setDur(e.payload.duration_ms);
          setPlaying(e.payload.playing);
        }
      )
    );
    // Ana pencere şarkı değişince başlık/sanatçı/kapak yollar.
    unlisten.push(
      listen<Meta>("mini-meta", (e) => setMeta(e.payload))
    );
    // Açılışta mevcut şarkıyı iste (pencere sonradan açıldıysa boş kalmasın).
    void emit("mini-command", { action: "sync" });
    return () => {
      unlisten.forEach((p) => void p.then((f) => f()));
    };
  }, []);

  const send = (action: string) => void emit("mini-command", { action });
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen w-screen select-none flex-col justify-between overflow-hidden bg-surface px-3 py-2.5 text-text"
    >
      <div className="flex items-center gap-2.5" data-tauri-drag-region>
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded bg-surface-2 text-faint">
          {meta?.thumbnail ? (
            <img src={meta.thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 size={18} />
          )}
        </div>
        <div className="min-w-0 flex-1" data-tauri-drag-region>
          <div className="truncate text-xs font-medium">
            {meta?.title ?? "Resonance"}
          </div>
          <div className="truncate text-[11px] text-muted">{meta?.artist ?? ""}</div>
        </div>
        <button
          onClick={() => void getCurrentWindow().close()}
          title={t("common.close")}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint hover:bg-surface-2 hover:text-text"
        >
          <X size={13} />
        </button>
      </div>

      <div className="mt-1.5">
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] tabular-nums text-faint">
            {formatMs(pos)}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => send("prev")}
              className="grid h-7 w-7 place-items-center rounded-full text-muted hover:text-text"
            >
              <SkipBack size={14} fill="currentColor" />
            </button>
            <button
              onClick={() => {
                // İyimser güncelleme: tick gelene kadar düğme donmuş görünmesin.
                setPlaying((p) => !p);
                send("toggle");
              }}
              className="grid h-8 w-8 place-items-center rounded-full bg-text text-bg"
            >
              {playing ? (
                <Pause size={14} fill="currentColor" />
              ) : (
                <Play size={14} fill="currentColor" className="ml-0.5" />
              )}
            </button>
            <button
              onClick={() => send("next")}
              className="grid h-7 w-7 place-items-center rounded-full text-muted hover:text-text"
            >
              <SkipForward size={14} fill="currentColor" />
            </button>
          </div>
          <span className="text-[10px] tabular-nums text-faint">
            {dur > 0 ? formatMs(dur) : "--:--"}
          </span>
        </div>
      </div>
    </div>
  );
}
