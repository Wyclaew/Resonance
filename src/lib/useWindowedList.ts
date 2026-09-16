import { useEffect, useRef, useState, type RefObject } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// PENCERELEME (v1.9.6) — uzun listelerde yalnız GÖRÜNEN satırları çiz.
//
// NEDEN: liste sayfası ve İndirilenler tüm satırları DOM'a basıyordu. Her
// `playback-tick` (250 ms) bu ağacın üstünden geçiyor; 1700 satırda hem ilk
// çizim hem kaydırma gözle görülür şekilde ağırlaşıyor, bellek de satır başına
// birkaç düğüm tutuyor.
//
// Kütüphane EKLEMİYORUZ: satır yüksekliği sabit (TrackRow ~52 px), o yüzden
// hangi aralığın görüneceği basit bir bölmeyle bulunur. Eşiğin altındaki
// listelerde (varsayılan 80) hiç devreye girmez → kısa listelerde davranış
// birebir aynı kalır.
// ═══════════════════════════════════════════════════════════════════════════

export interface Windowed {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  enabled: boolean;
}

export function useWindowedList(
  ref: RefObject<HTMLElement | null>,
  count: number,
  rowHeight = 52,
  threshold = 80,
  overscan = 12
): Windowed {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, threshold) });
  const frame = useRef<number | null>(null);
  const enabled = count > threshold;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setRange({ start: 0, end: count });
      return;
    }
    const measure = () => {
      frame.current = null;
      const h = el.clientHeight || 600;
      const first = Math.max(0, Math.floor(el.scrollTop / rowHeight) - overscan);
      const visible = Math.ceil(h / rowHeight) + overscan * 2;
      setRange({ start: first, end: Math.min(count, first + visible) });
    };
    const onScroll = () => {
      // rAF: kaydırma olayı saniyede onlarca kez gelir, state'i bir kez tazele.
      if (frame.current === null) frame.current = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [ref, count, rowHeight, overscan, enabled]);

  if (!enabled) {
    return { start: 0, end: count, padTop: 0, padBottom: 0, enabled: false };
  }
  return {
    start: range.start,
    end: range.end,
    padTop: range.start * rowHeight,
    padBottom: Math.max(0, (count - range.end) * rowHeight),
    enabled: true,
  };
}
