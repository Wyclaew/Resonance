import { useRef, useState } from "react";
import { MonitorSmartphone, Laptop, Smartphone, Monitor } from "lucide-react";
import Popover from "./Popover";
import { useT } from "../lib/i18n";
import { listHandoffTargets, sendHandoff, type HandoffTarget } from "../lib/remote";
import { useToastStore } from "../store/useToastStore";
import { isSyncConfigured } from "../lib/sync/config";

function DeviceIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.includes("android") || n.includes("ios")) return <Smartphone size={15} />;
  if (n.includes("mac")) return <Laptop size={15} />;
  return <Monitor size={15} />;
}

/**
 * ⭐ BAŞKA CİHAZDA ÇAL (v1.9.8) — alt bardaki düğme. Çalanı kuyruğu ve
 * saniyesiyle seçilen cihaza gönderir (bkz. `remote.ts` → handoff), burada
 * duraklatır. Masaüstü → masaüstü bugün çalışır; telefon tarafında alıcı
 * mobil uygulamaya eklenince telefona da gider.
 */
export default function HandoffButton() {
  const t = useT();
  const toast = useToastStore((s) => s.show);
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<HandoffTarget[] | null>(null);

  if (!isSyncConfigured()) return null;

  const ago = (ms: number) => {
    const mins = Math.max(1, Math.round((Date.now() - ms) / 60000));
    if (mins < 60) return t("device.minsAgo", { n: mins });
    const hours = Math.round(mins / 60);
    if (hours < 24) return t("device.hoursAgo", { n: hours });
    return t("device.daysAgo", { n: Math.round(hours / 24) });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          void listHandoffTargets().then(setTargets);
        }}
        title={t("remote.handoffTitle")}
        className={`grid h-8 w-8 place-items-center rounded-md transition-colors hover:text-text ${
          open ? "text-text" : "text-muted"
        }`}
      >
        <MonitorSmartphone size={17} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="up" width={260}>
        <div className="px-2.5 pb-1 pt-1 text-sm font-medium">{t("remote.handoffTitle")}</div>
        <p className="px-2.5 pb-2 text-[11px] leading-relaxed text-faint">
          {t("remote.handoffHint")}
        </p>
        {(targets ?? []).map((d) => (
          <button
            key={d.deviceId}
            onClick={async () => {
              setOpen(false);
              const ok = await sendHandoff(d);
              toast(
                ok ? t("remote.handoffSent", { device: d.name }) : t("remote.handoffFailed"),
                ok ? "success" : "error"
              );
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
          >
            <span className="text-accent">
              <DeviceIcon name={d.name} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{d.name}</span>
              <span className="block text-[11px] text-faint">
                {t("remote.lastSeen", { ago: ago(d.lastSeen) })}
              </span>
            </span>
          </button>
        ))}
        {targets !== null && targets.length === 0 && (
          <p className="px-2.5 py-2 text-sm text-muted">{t("remote.handoffNone")}</p>
        )}
      </Popover>
    </div>
  );
}
