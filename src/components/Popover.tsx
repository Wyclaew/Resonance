import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

// ═══════════════════════════════════════════════════════════════════════════
// AÇILIR MENÜ — TEK YER (v1.9.7)
//
// ⛔ NEDEN: menüler `absolute` ile tetikleyicinin yanına çiziliyordu. Herhangi
// bir ata `overflow-hidden`/`overflow-y-auto` ise menü KESİLİYOR ya da komşu
// bir öğenin ARKASINDA kalıyordu. Kullanıcının yakaladığı: alt barda "listeye
// ekle" menüsü açılıyor ama listeler görünmüyordu — v1.9.3'te alt bara
// bulanık kapak için `overflow-hidden` eklenmişti. Bu sınıf hata her yeni
// kapsayıcıyla geri gelir; kalıcı çözüm menüyü `document.body`'ye portal ile
// çizmek (InfoHint ile aynı yöntem).
//
// Konum `fixed`; tetikleyicinin dikdörtgeninden hesaplanır, sığmazsa ters
// yöne açılır, ekrandan taşmaz. Dışarı tıklama ve Esc kapatır; kaydırma ve
// pencere boyutu değişince yeniden konumlanır.
// ═══════════════════════════════════════════════════════════════════════════

interface Props {
  /** Tetikleyicinin (ya da sarmalayıcısının) ref'i. */
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Tercih edilen yön; sığmazsa ters çevrilir. */
  placement?: "down" | "up";
  /** Menünün hangi kenarı tetikleyiciyle hizalansın. */
  align?: "start" | "end";
  /** px; verilmezse içerik genişliği. */
  width?: number;
  className?: string;
  children: React.ReactNode;
}

const GAP = 6;
const MARGIN = 8;

export default function Popover({
  anchor,
  open,
  onClose,
  placement = "down",
  align = "end",
  width,
  className = "",
  children,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);

  const place = () => {
    const a = anchor.current;
    const box = boxRef.current;
    if (!a || !box) return;
    const r = a.getBoundingClientRect();
    const w = width ?? box.offsetWidth;
    const h = box.scrollHeight;
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const goUp = placement === "up" ? !(above < h && below > above) : below < h && above > below;
    const maxH = Math.max(120, goUp ? above : below);
    const shown = Math.min(h, maxH);
    let left = align === "end" ? r.right - w : r.left;
    left = Math.min(Math.max(MARGIN, left), window.innerWidth - w - MARGIN);
    const top = goUp ? r.top - GAP - shown : r.bottom + GAP;
    setPos({ left, top, maxH });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let frame: number | null = null;
    const relayout = () => {
      if (frame === null)
        frame = requestAnimationFrame(() => {
          frame = null;
          place();
        });
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", relayout, true);
    window.addEventListener("resize", relayout);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", relayout, true);
      window.removeEventListener("resize", relayout);
      if (frame !== null) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={boxRef}
      // ⚠️ React olayları PORTAL'dan da React atasına kabarır: menü bir satırın
      // içinden açıldıysa menüdeki tık/çift tık/sağ tık o SATIRI tetiklerdi
      // (seçim, çalma, şarkı detayı). Hepsi burada durdurulur.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
        maxHeight: pos?.maxH,
        zIndex: 80,
        visibility: pos ? "visible" : "hidden",
      }}
      className={`animate-pop-in overflow-y-auto rounded-xl border border-border bg-surface/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}
