import { useEffect, useRef, useState } from "react";
import { useT } from "../lib/i18n";

// ═══════════════════════════════════════════════════════════════════════════
// PROFİL FOTOĞRAFI KIRPMA (v1.9.6)
//
// Eskiden seçilen dosya olduğu gibi kaydediliyordu ve yuvarlak çerçevede
// `object-cover` ile ORTADAN kırpılıyordu — yüz kenarda kalırsa kesiliyordu
// (kullanıcının isteği: "nereye geleceğini ayarlayabileyim").
//
// Sürükle = konum, kaydırıcı = yakınlaştırma. Kaydederken 256×256 JPEG'e
// çizilir: `settings` tablosunda data URI olarak durduğu için boyut ÖNEMLİ
// (512 KB sınırı vardı; 256px JPEG ~20-40 KB).
// ═══════════════════════════════════════════════════════════════════════════

const VIEW = 224; // düzenleme dairesinin çapı (px)
const OUT = 256; // kaydedilen kare (px)

export default function AvatarEditor({
  src,
  onCancel,
  onSave,
}: {
  src: string;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const t = useT();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = src;
  }, [src]);

  // Dairenin tamamını kaplayan taban ölçek ("cover").
  const base = img ? Math.max(VIEW / img.width, VIEW / img.height) : 1;
  const scale = base * zoom;

  const clamp = (v: { x: number; y: number }) => {
    if (!img) return v;
    const maxX = Math.max(0, (img.width * scale - VIEW) / 2);
    const maxY = Math.max(0, (img.height * scale - VIEW) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, v.x)),
      y: Math.min(maxY, Math.max(-maxY, v.y)),
    };
  };

  useEffect(() => {
    setOff((o) => clamp(o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, img]);

  const save = () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const k = OUT / VIEW; // düzenleme ölçeğinden çıktı ölçeğine
    const w = img.width * scale * k;
    const h = img.height * scale * k;
    ctx.fillStyle = "#141416";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, OUT / 2 - w / 2 + off.x * k, OUT / 2 - h / 2 + off.y * k, w, h);
    onSave(canvas.toDataURL("image/jpeg", 0.9));
  };

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="animate-panel-in w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <div className="text-sm font-medium">{t("profile.avatarEdit")}</div>
        <p className="mt-1 text-xs text-muted">{t("profile.avatarEditHelp")}</p>

        <div
          className="mx-auto mt-4 overflow-hidden rounded-full border border-border bg-surface-2"
          style={{ width: VIEW, height: VIEW, touchAction: "none" }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX - off.x, y: e.clientY - off.y };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setOff(clamp({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {img && (
            <img
              src={src}
              alt=""
              draggable={false}
              className="cursor-grab select-none active:cursor-grabbing"
              style={{
                width: img.width * scale,
                height: img.height * scale,
                transform: `translate(${off.x}px, ${off.y}px)`,
                marginLeft: (VIEW - img.width * scale) / 2,
                marginTop: (VIEW - img.height * scale) / 2,
                maxWidth: "none",
              }}
            />
          )}
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="resonance-range mt-4 w-full"
          style={{ ["--pct" as string]: `${((zoom - 1) / 2) * 100}%` }}
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-text"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            disabled={!img}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
