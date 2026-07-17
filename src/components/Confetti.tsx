import { useEffect, useState } from "react";

// Küçük konfeti — imzaya (Wyclaew) tıklayınca patlar.
// Bilerek bağımlılıksız: ~40 div, CSS keyframe ile düşer, 2.2sn sonra kendini
// söker. Canvas/lib gerekmez, uygulamanın "hafiflik" şartını bozmaz.

const COLORS = [
  "var(--color-accent)",
  "#5fb87f",
  "#4f9bd9",
  "#e0667f",
  "#b07ad9",
  "#e9e7e1",
];
const PIECES = 40;
const DURATION = 2200;

interface Piece {
  id: number;
  left: number;
  delay: number;
  dur: number;
  color: string;
  size: number;
  rot: number;
  drift: number;
}

function make(): Piece[] {
  return Array.from({ length: PIECES }, (_, id) => ({
    id,
    left: Math.random() * 100,
    delay: Math.random() * 350,
    dur: 1400 + Math.random() * 700,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 5 + Math.random() * 6,
    rot: Math.random() * 360,
    drift: (Math.random() - 0.5) * 120,
  }));
}

export default function Confetti({ onDone }: { onDone: () => void }) {
  const [pieces] = useState(make);

  useEffect(() => {
    const t = setTimeout(onDone, DURATION);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    // pointer-events-none: konfeti tıklamaları engellemesin.
    <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 animate-confetti"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 1.6,
            backgroundColor: p.color,
            animationDelay: `${p.delay}ms`,
            animationDuration: `${p.dur}ms`,
            // @ts-expect-error — CSS özel değişkenleri (keyframe okuyor)
            "--rot": `${p.rot}deg`,
            "--drift": `${p.drift}px`,
            borderRadius: p.id % 3 === 0 ? "50%" : "1px",
          }}
        />
      ))}
    </div>
  );
}
