import { useEffect, useRef, type RefObject } from "react";

// ⭐ KAYDIRMA KONUMU HATIRLANIR (v1.9.9): uzun listede (liste sayfası,
// İndirilenler) bir şarkıyı çalıp başka sayfaya gidip dönünce eskiden en
// başa atıyordu. Konum bellekte (oturum boyu) `anahtar → scrollTop` olarak
// durur; kalıcı DEĞİL — yeniden başlatınca başa dönmesi beklenen davranış.
//
// ⚠️ App.tsx görünümü `key` ile yeniden bağlıyor → kaydırma kabı her gidişte
// sıfırdan oluşur. İki tuzak:
//  1. Satırlar henüz yokken (`ready=false`) scroll olayı 0 yazıp kayıtlı
//     konumu EZMESİN → kayıt yalnız geri yüklemeden SONRA başlar.
//  2. Pencereleme (useWindowedList) üst/alt boşluğu bir efektten sonra
//     kurduğu için içerik yüksekliği ilk karede eksik olabilir → birkaç
//     kare boyunca hedefe ulaşana dek yeniden denenir.
const positions = new Map<string, number>();

export function useScrollRestore(
  ref: RefObject<HTMLElement | null>,
  key: string,
  ready: boolean
): void {
  const restored = useRef(false);

  useEffect(() => {
    restored.current = false;
  }, [key]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ready || restored.current) return;
    const target = positions.get(key) ?? 0;
    let frame = 0;
    let tries = 0;
    const apply = () => {
      el.scrollTop = target;
      tries++;
      const reached = Math.abs(el.scrollTop - target) < 2;
      if (reached || tries >= 6) {
        restored.current = true;
        return;
      }
      frame = requestAnimationFrame(apply);
    };
    if (target === 0) {
      restored.current = true;
      return;
    }
    frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [ref, key, ready]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (restored.current) positions.set(key, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, key]);
}
