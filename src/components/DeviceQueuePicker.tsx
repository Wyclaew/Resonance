import { useEffect, useRef, useState } from "react";
import { Laptop, Smartphone, Monitor } from "lucide-react";
import { useT } from "../lib/i18n";
import { listRemoteQueues, type RemoteQueue } from "../lib/deviceQueue";
import { usePlayerStore } from "../store/usePlayerStore";
import { useToastStore } from "../store/useToastStore";

// ═══════════════════════════════════════════════════════════════════════════
// "ŞU CİHAZDAKİ KEŞFETİ GETİR" — cihazlar arası kuyruk seçici.
//
// NEDEN: `device_queue` her cihazın kuyruğunu ayrı satırda tutuyor ve açılışta
// EN YENİSİ otomatik devralınıyor. Üç cihaz varken (Mac / Windows / telefon)
// bu yetmiyor: kullanıcı hangisinden devam edeceğini kendi seçmek istiyor.
// Otomatik devralma dururken bu düğme AÇIK seçim sunar.
// ═══════════════════════════════════════════════════════════════════════════

function DeviceIcon({ name, size = 14 }: { name: string; size?: number }) {
  const n = name.toLowerCase();
  if (n.includes("android") || n.includes("ios")) return <Smartphone size={size} />;
  if (n.includes("mac")) return <Laptop size={size} />;
  return <Monitor size={size} />;
}

function ago(t: ReturnType<typeof useT>, ms: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return t("device.minsAgo", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("device.hoursAgo", { n: hours });
  return t("device.daysAgo", { n: Math.round(hours / 24) });
}

export default function DeviceQueuePicker() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RemoteQueue[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const restoreDiscovery = usePlayerStore((s) => s.restoreDiscovery);
  const restoreQueue = usePlayerStore((s) => s.restoreQueue);
  const toast = useToastStore((s) => s.show);

  // Menü kapalıyken de bir kez bak: hiç cihaz yoksa düğmeyi hiç gösterme.
  useEffect(() => {
    void listRemoteQueues().then(setRows);
  }, []);

  useEffect(() => {
    if (!open) return;
    void listRemoteQueues().then(setRows);
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (rows.length === 0) return null;

  const load = (r: RemoteQueue) => {
    setOpen(false);
    if (r.mode === "discovery") {
      restoreDiscovery({
        queue: r.queue,
        queueIndex: r.queueIndex,
        seedArtists: r.seeds,
        filters: r.filters,
        positionMs: r.positionMs,
      });
    } else {
      restoreQueue(r.queue, r.queueIndex, r.positionMs);
    }
    toast(t("device.loaded", { device: r.deviceName }), "success");
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("device.pickTitle")}
        className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted transition-colors hover:text-text"
      >
        <Laptop size={14} />
        {t("device.pick")}
      </button>

      {open && (
        <div className="animate-pop-in absolute right-0 z-50 mt-2 w-80 origin-top-right overflow-hidden rounded-xl border border-border bg-surface/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <p className="px-2.5 pb-2 pt-1.5 text-xs text-muted">
            {t("device.pickHint")}
          </p>
          {rows.map((r) => {
            const cur = r.queue[r.queueIndex];
            return (
              <button
                key={r.deviceId}
                onClick={() => load(r)}
                className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
              >
                <span className="relative shrink-0">
                  {cur?.thumbnail ? (
                    <img
                      src={cur.thumbnail}
                      alt=""
                      className="h-10 w-10 rounded-md object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="block h-10 w-10 rounded-md bg-surface-3" />
                  )}
                  <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-accent">
                    <DeviceIcon name={r.deviceName} size={11} />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-sm font-medium text-text">
                      {r.deviceName}
                    </span>
                    {r.mode === "discovery" && (
                      <span className="shrink-0 rounded-full bg-accent/12 px-1.5 py-px text-[10px] font-medium text-accent">
                        {t("nav.discover")}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-faint">
                      {ago(t, r.updatedAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {t("device.queueInfo", {
                      count: r.queue.length,
                      title: cur?.title ?? "—",
                    })}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
