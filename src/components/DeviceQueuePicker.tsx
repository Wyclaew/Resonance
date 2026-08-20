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

function DeviceIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.includes("android") || n.includes("ios")) return <Smartphone size={14} />;
  if (n.includes("mac")) return <Laptop size={14} />;
  return <Monitor size={14} />;
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
        <div className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <p className="border-b border-border px-3 py-2 text-xs text-muted">
            {t("device.pickHint")}
          </p>
          {rows.map((r) => (
            <button
              key={r.deviceId}
              onClick={() => load(r)}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
            >
              <span className="mt-0.5 text-accent">
                <DeviceIcon name={r.deviceName} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {r.deviceName}
                  {r.mode === "discovery" && (
                    <span className="ml-1.5 text-xs text-accent">
                      · {t("nav.discover")}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted">
                  {t("device.queueInfo", {
                    count: r.queue.length,
                    title: r.queue[r.queueIndex]?.title ?? "—",
                  })}
                </span>
                <span className="block text-[11px] text-faint">
                  {ago(t, r.updatedAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
