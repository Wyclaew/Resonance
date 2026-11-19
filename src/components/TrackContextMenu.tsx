import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, ListEnd, ListStart } from "lucide-react";
import type { Track } from "../types";
import { useT } from "../lib/i18n";
import { usePlayerStore } from "../store/usePlayerStore";
import { useToastStore } from "../store/useToastStore";

const MENU_WIDTH = 220;
const EDGE = 8;

/**
 * Şarkı satırının sağ tık menüsü. İmlecin olduğu yerde açılır (Popover bir
 * öğeye bağlanır, burada bağlanacak öğe yok), ekrana sığmazsa içeri itilir.
 * ⚠️ PORTAL'dan gelen React olayları ataya (satıra) KABARIR: tık satırda
 * çift tık/seçim tetiklemesin diye hepsi burada durdurulur (Popover dersi).
 */
export default function TrackContextMenu({
  track,
  x,
  y,
  onDetail,
  onClose,
}: {
  track: Track;
  x: number;
  y: number;
  onDetail: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const toast = useToastStore((s) => s.show);

  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setPos({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - MENU_WIDTH - EDGE)),
      top: Math.max(EDGE, y + h > window.innerHeight - EDGE ? y - h : y),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const item = (icon: React.ReactNode, label: string, fn: () => void) => (
    <button
      onClick={() => {
        fn();
        onClose();
      }}
      className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm text-muted hover:bg-surface-3 hover:text-text"
    >
      <span className="shrink-0 text-faint">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      ref={ref}
      onClick={stop}
      onDoubleClick={stop}
      onMouseDown={stop}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      className="animate-panel-in fixed z-[85] rounded-lg border border-border bg-surface-2 p-1 shadow-2xl shadow-black/40"
    >
      {item(<ListStart size={15} />, t("queue.playNext"), () => {
        playNext(track);
        toast(t("queue.addedNext", { title: track.title }), "info");
      })}
      {item(<ListEnd size={15} />, t("queue.addToQueue"), () => {
        addToQueue(track);
        toast(t("queue.addedEnd", { title: track.title }), "info");
      })}
      <div className="my-1 h-px bg-border" />
      {item(<Info size={15} />, t("trackDetail.open"), onDetail)}
    </div>,
    document.body
  );
}
