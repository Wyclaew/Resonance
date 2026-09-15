import { ListMusic } from "lucide-react";

/**
 * Liste kapağı: parçaların kapaklarından 1/2/4'lü mozaik. Kapak yoksa
 * vurgu renginde nota simgesi (eski görünüm).
 *
 * Mobil uygulamadaki `Mosaic` ile aynı fikir — iki uygulama aynı görünsün.
 */
export default function Mosaic({
  covers,
  size = 48,
  rounded = "rounded-lg",
}: {
  covers?: string[];
  size?: number;
  rounded?: string;
}) {
  const list = (covers ?? []).slice(0, 4);
  if (list.length === 0) {
    return (
      <div
        className={`grid shrink-0 place-items-center bg-accent/15 text-accent ${rounded}`}
        style={{ width: size, height: size }}
      >
        <ListMusic size={Math.round(size * 0.45)} />
      </div>
    );
  }
  const cells = list.length >= 4 ? list.slice(0, 4) : [list[0]];
  return (
    <div
      className={`grid shrink-0 overflow-hidden bg-surface-3 ${rounded} ${
        cells.length === 4 ? "grid-cols-2 grid-rows-2" : ""
      }`}
      style={{ width: size, height: size }}
    >
      {cells.map((src, i) => (
        <img
          key={`${src}-${i}`}
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ))}
    </div>
  );
}
