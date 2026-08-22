import { useEffect, useState } from "react";
import { X, Clock, Play, SkipForward, CheckCircle2, User } from "lucide-react";
import type { Track } from "../types";
import { useT } from "../lib/i18n";
import { formatMs } from "../lib/format";
import { getTrackStats, type TrackStats } from "../lib/history";
import { useAppStore } from "../store/useAppStore";

// ═══════════════════════════════════════════════════════════════════════════
// ŞARKI DETAYI — "bu şarkıyla aramızda ne geçti?"
//
// Veri `play_history`'den türetilir (senkronlanıyor → tüm cihazların toplamı).
// ⚠️ "Tamamlanan / atlanan" eşikleri öneri motorununkiyle AYNI (>%70 / <%15):
// kullanıcının ekranda gördüğü sayı, modelin gördüğü sinyalle aynı şey olmalı.
// ═══════════════════════════════════════════════════════════════════════════

export default function TrackDetail({
  track,
  onClose,
}: {
  track: Track;
  onClose: () => void;
}) {
  const t = useT();
  const navigate = useAppStore((s) => s.navigate);
  const [st, setSt] = useState<TrackStats | null>(null);

  useEffect(() => {
    void getTrackStats(track.id, track.durationMs).then(setSt);
  }, [track.id, track.durationMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const maxHour = st ? Math.max(1, ...st.byHour) : 1;
  const fmtDate = (ms: number | null) =>
    ms ? new Date(ms).toLocaleDateString() : "—";

  return (
    <div
      className="fixed inset-0 z-[65] grid place-items-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[28rem] max-w-[92vw] animate-pop-in rounded-xl border border-border bg-surface-2 p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-surface-3">
            {track.thumbnail && (
              <img src={track.thumbnail} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-snug">{track.title}</div>
            <button
              onClick={() => {
                navigate("artist", track.artist);
                onClose();
              }}
              className="mt-0.5 flex items-center gap-1 text-xs text-muted transition-colors hover:text-accent"
            >
              <User size={11} />
              {track.artist}
            </button>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-surface-3 hover:text-text"
          >
            <X size={15} />
          </button>
        </div>

        {!st || st.plays === 0 ? (
          <p className="mt-5 text-sm text-faint">{t("trackDetail.never")}</p>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Cell icon={<Play size={13} />} value={String(st.plays)} label={t("trackDetail.plays")} />
              <Cell
                icon={<CheckCircle2 size={13} />}
                value={String(st.completed)}
                label={t("trackDetail.completed")}
              />
              <Cell
                icon={<SkipForward size={13} />}
                value={String(st.skipped)}
                label={t("trackDetail.skipped")}
              />
            </div>

            <p className="mt-4 text-xs leading-relaxed text-muted">
              {t("trackDetail.summary", {
                total: formatMs(st.totalMs),
                first: fmtDate(st.firstAt),
                last: fmtDate(st.lastAt),
              })}
            </p>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-faint">
                <Clock size={11} /> {t("trackDetail.byHour")}
              </div>
              <div className="flex h-12 items-end gap-[2px]">
                {st.byHour.map((n, h) => (
                  <div
                    key={h}
                    title={`${String(h).padStart(2, "0")}:00 — ${n}`}
                    className="flex-1 rounded-t bg-accent/70"
                    style={{ height: `${Math.max(3, (n / maxHour) * 100)}%` }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Cell({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 text-center">
      <div className="flex justify-center text-accent">{icon}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
