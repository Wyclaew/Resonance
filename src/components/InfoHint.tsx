import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// (?) İPUCU — uzun açıklamalar satırın altında yer kaplamasın (v1.9.6).
//
// ⚠️ BALON PORTAL İLE ÇİZİLİR (document.body): Ayarlar sayfasındaki kartlar
// `overflow-y-auto` bir kabın içinde; balon normal akışta çizilseydi kabın
// kenarında KESİLİR ya da komşu kartın altında kalırdı. Portal + `position:
// fixed` ile hem kesilmez hem de her şeyin üstünde durur (z-index 100).
//
// Fare ile üstüne gelince, klavyeyle odaklanınca ve dokunmatikte tıklayınca
// açılır; Esc kapatır. Ekran dışına taşarsa yatayda içeri çekilir, aşağı
// sığmıyorsa düğmenin ÜSTÜNDE açılır.
// ═══════════════════════════════════════════════════════════════════════════

interface Props {
  /** Gösterilecek açıklama (düz metin). */
  text: string;
  /** Balon genişliği (px) — uzun metinlerde 320 iyi çalışıyor. */
  width?: number;
  className?: string;
}

export default function InfoHint({ text, width = 300, className = "" }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean }>({
    left: 0,
    top: 0,
    above: false,
  });

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const estimatedHeight = Math.max(64, Math.ceil(text.length / 48) * 20 + 24);
    const above = r.bottom + estimatedHeight + margin > window.innerHeight;
    const left = Math.min(
      Math.max(margin, r.left + r.width / 2 - width / 2),
      window.innerWidth - width - margin
    );
    setPos({
      left,
      top: above ? r.top - margin : r.bottom + margin,
      above,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    // Kaydırınca balon düğmeden ayrılmasın: kapat (yeniden aç kolay).
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const show = () => {
    place();
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={text}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          if (open) setOpen(false);
          else show();
        }}
        className={`inline-grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-faint transition-colors hover:text-accent focus-visible:text-accent ${className}`}
      >
        <HelpCircle size={15} />
      </button>
      {open &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width,
              transform: pos.above ? "translateY(-100%)" : undefined,
              zIndex: 100,
            }}
            className="pointer-events-none rounded-xl border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted shadow-2xl shadow-black/40"
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}
