import { useState } from "react";
import {
  X,
  Music2,
  Sparkles,
  GripVertical,
  ListMusic,
  Dice5,
  Loader2,
} from "lucide-react";
import { usePlayerStore, DISCOVERY_ID } from "../store/usePlayerStore";
import { useT } from "../lib/i18n";
import { reasonText } from "../lib/recommender";
import { useSettingsStore } from "../store/useSettingsStore";
import { useAppStore } from "../store/useAppStore";
import { formatMs } from "../lib/format";

// Sıra (Queue) paneli — çalan kuyruğu gör/yönet: tıkla→atla, sürükle-bırak
// sırala, kuyruktan çıkar. Öneri serpiştirmeleri işaretlenir.
export default function QueuePanel() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const moveInQueue = usePlayerStore((s) => s.moveInQueue);
  const toggleQueue = useAppStore((s) => s.toggleQueue);
  // Keşif modundaysa "başka tarz" (reroll) butonu göster.
  const radioPlaylistId = usePlayerStore((s) => s.radioPlaylistId);
  const rerollDiscovery = usePlayerStore((s) => s.rerollDiscovery);
  const discovering = usePlayerStore((s) => s.discovering);
  const seedArtists = usePlayerStore((s) => s.discoverySeedArtists);
  const inDiscovery = radioPlaylistId === DISCOVERY_ID;

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const upcoming = queue
    .map((item, idx) => ({ item, idx }))
    .filter(({ idx }) => idx > queueIndex);

  function onDrop(toIdx: number) {
    if (dragIdx !== null && dragIdx !== toIdx) moveInQueue(dragIdx, toIdx);
    setDragIdx(null);
    setOverIdx(null);
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg/95 backdrop-blur-sm animate-panel-in">
      <header className="flex items-center justify-between px-8 pb-3 pt-6">
        <div className="flex items-center gap-2">
          <ListMusic size={18} className="text-accent" />
          <h2 className="text-lg font-semibold">{t("queue.title")}</h2>
          <span className="text-sm text-faint">
            {t("queue.upcomingCount", { count: upcoming.length })}
          </span>
          {/* Keşifte: sıranın hangi tarzlardan geldiğini göster. */}
          {inDiscovery && seedArtists.length > 0 && (
            <span className="hidden truncate text-sm text-faint sm:inline">
              · {t("queue.styleOf", { artists: seedArtists.join(", ") })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Tarzı beğenmediysen: başka sanatçıların radyolarından yeni parti. */}
          {inDiscovery && (
            <button
              onClick={() => void rerollDiscovery()}
              disabled={discovering}
              title={t("queue.rerollHint")}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-surface hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              {discovering ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Dice5 size={15} />
              )}
              {t("queue.reroll")}
            </button>
          )}
          <button
            onClick={toggleQueue}
            title={t("common.close")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-text"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-16 pt-2">
        {!current && (
          <p className="py-24 text-center text-sm text-faint">
            {t("queue.empty")}
          </p>
        )}

        {/* Şimdi çalıyor */}
        {current && (
          <>
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              {t("queue.nowPlaying")}
            </div>
            <div className="mb-4 flex items-center gap-3 rounded-md bg-surface-2 px-2 py-1.5">
              <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded bg-surface-3 text-faint">
                {current.thumbnail ? (
                  <img
                    src={current.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Music2 size={16} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-accent">
                  {current.title}
                </div>
                <div className="truncate text-xs text-muted">
                  {current.artist}
                </div>
              </div>
              <span
                className={`text-[10px] font-medium uppercase tracking-wide ${
                  status === "playing" ? "text-accent" : "text-faint"
                }`}
              >
                {status === "loading"
                  ? t("queue.loading")
                  : status === "playing"
                  ? t("queue.playing")
                  : t("queue.paused")}
              </span>
            </div>
          </>
        )}

        {/* Sıradakiler */}
        {upcoming.length > 0 && (
          <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            {t("queue.upcoming")}
          </div>
        )}
        {current && upcoming.length === 0 && (
          <p className="px-2 py-6 text-sm text-faint">
            {t("queue.noMore")}
          </p>
        )}

        {upcoming.map(({ item, idx }) => (
          <div
            key={item.uid}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIdx(idx);
            }}
            onDrop={() => onDrop(idx)}
            onDragEnd={() => {
              setDragIdx(null);
              setOverIdx(null);
            }}
            onDoubleClick={() => jumpTo(idx)}
            className={`group grid grid-cols-[1.25rem_2.25rem_1fr_auto] items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface ${
              dragIdx === idx ? "opacity-40" : ""
            } ${overIdx === idx && dragIdx !== idx ? "bg-surface-2" : ""}`}
          >
            <GripVertical
              size={14}
              className="cursor-grab text-faint opacity-0 group-hover:opacity-100 active:cursor-grabbing"
            />
            <button
              onClick={() => jumpTo(idx)}
              title={t("queue.jumpTo")}
              className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded bg-surface-3 text-faint"
            >
              {item.thumbnail ? (
                <img
                  src={item.thumbnail}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Music2 size={15} />
              )}
            </button>
            <div className="min-w-0">
              {item.isRecommendation && (
                <div
                  className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent"
                  title={reasonText(item.recReason, lang)}
                >
                  <Sparkles size={10} /> {t("queue.pickBadge")}
                </div>
              )}
              <div className="truncate text-sm text-text">{item.title}</div>
              <div className="truncate text-xs text-muted">{item.artist}</div>
            </div>
            <div className="flex items-center gap-1.5 pr-1">
              <span className="tnum text-xs text-muted">
                {formatMs(item.durationMs)}
              </span>
              <button
                onClick={() => removeFromQueue(item.uid)}
                title={t("queue.remove")}
                className="grid h-7 w-7 place-items-center text-faint opacity-0 transition-colors hover:text-down group-hover:opacity-100"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
