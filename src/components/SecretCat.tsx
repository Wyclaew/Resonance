// Gizli kedi + kalp — Hakkında'da imzaya 7 kez tıklayınca ortaya çıkar.
//
// Emoji DEĞİL, çizim: emoji'nin rengi/biçimi işletim sistemine göre değişiyordu
// ve temaya uyum sağlamıyordu. Bu bir SVG çizim:
//  • Kedi `currentColor` kullanır → `text-text` ile koyu temada BEYAZ,
//    açık temada SİYAH olur (semantik token zaten bunu yapıyor).
//  • Kalp ayrı renkte (kırmızı) ve dolu — küçük bir vurgu.

export function CatDrawing({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Kulaklar */}
      <path d="M15.5 15.5 L13.5 7 L21 12.5" />
      <path d="M32.5 15.5 L34.5 7 L27 12.5" />
      {/* Baş */}
      <path d="M24 11.5 c-6 0 -10.5 4.2 -10.5 9.5 c0 5.3 4.5 9 10.5 9 c6 0 10.5 -3.7 10.5 -9 c0 -5.3 -4.5 -9.5 -10.5 -9.5 z" />
      {/* Gözler (kapalı, mutlu kedi) */}
      <path d="M18.5 19.5 c1 1.2 2.4 1.2 3.4 0" />
      <path d="M26.1 19.5 c1 1.2 2.4 1.2 3.4 0" />
      {/* Burun + ağız */}
      <path d="M24 23 l-1.2 1.2 M24 23 l1.2 1.2" />
      {/* Bıyıklar */}
      <path d="M11 20 l3.5 0.6 M11 23.4 l3.6 -0.7" />
      <path d="M37 20 l-3.5 0.6 M37 23.4 l-3.6 -0.7" />
      {/* Gövde (oturan) */}
      <path d="M16.5 28.5 c-2.6 3.4 -3.4 8.4 -2 12.5 l19 0 c1.4 -4.1 0.6 -9.1 -2 -12.5" />
      {/* Ön patiler */}
      <path d="M20 41 v-3.2 M24 41 v-3.2 M28 41 v-3.2" />
      {/* Kuyruk */}
      <path d="M33.5 41 c5.5 0.4 8.5 -3.6 6.6 -7.2 c-1 -1.9 -3.2 -2.3 -4.4 -1" />
    </svg>
  );
}

export function HeartDrawing({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 20.7 C12 20.7 2.8 14.9 2.8 8.9 C2.8 5.9 5.2 3.5 8.2 3.5 C9.9 3.5 11.4 4.4 12 5.6 C12.6 4.4 14.1 3.5 15.8 3.5 C18.8 3.5 21.2 5.9 21.2 8.9 C21.2 14.9 12 20.7 12 20.7 Z" />
    </svg>
  );
}
