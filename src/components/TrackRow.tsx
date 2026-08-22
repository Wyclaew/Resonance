import { Play, Pause, Music2, Loader2, Download, CircleCheck, X } from "lucide-react";
import type { Track } from "../types";
import { formatMs } from "../lib/format";
import { useLibraryStore } from "../store/useLibraryStore";
import { useState } from "react";
import { useT } from "../lib/i18n";
import TrackDetail from "./TrackDetail";
import AddToPlaylistButton from "./AddToPlaylistButton";

interface TrackRowProps {
  track: Track;
  index?: number;
  isCurrent?: boolean;
  isPlaying?: boolean;
  isLoading?: boolean;
  onPlay: () => void;
  // çalma listesinden çıkar (verilirse çıkar düğmesi gösterilir)
  onRemove?: () => void;
  // sürükle-bırak (çalma listesi sıralaması)
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  // sağ tarafa ek içerik (ör. karma oyları — M3)
  trailing?: React.ReactNode;
}

export default function TrackRow({
  track,
  index,
  isCurrent,
  isPlaying,
  isLoading,
  onPlay,
  onRemove,
  draggable,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  trailing,
}: TrackRowProps) {
  const t = useT();
  const downloaded = useLibraryStore((s) => s.downloadedIds.has(track.id));
  const downloading = useLibraryStore((s) => s.downloadingIds.has(track.id));
  const download = useLibraryStore((s) => s.download);
  const remove = useLibraryStore((s) => s.remove);
  const [detail, setDetail] = useState(false);

  function handleDownloadClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (downloading) return;
    if (downloaded) remove(track);
    else download(track);
  }

  return (
    <>
    {detail && (
      <TrackDetail track={track} onClose={() => setDetail(false)} />
    )}
    <div
      onDoubleClick={onPlay}
      // ⭐ Sağ tık → şarkı detayı (kaç kez çaldın, hangi saatlerde, kaç kez
      // atladın). Ayrı bir menü açmak yerine doğrudan detay: tek eylem var.
      onContextMenu={(e) => {
        e.preventDefault();
        setDetail(true);
      }}
      title={t("trackDetail.open")}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group relative grid grid-cols-[2rem_2.5rem_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 ${
        isCurrent ? "bg-accent/10" : "hover:bg-surface"
      } ${isDragging ? "opacity-40" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {/* Çalan satırın sol kenarında vurgu şeridi (sidebar aktif öğe diliyle aynı). */}
      {isCurrent && (
        <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
      )}
      {/* İndeks / oynat düğmesi */}
      <button
        onClick={onPlay}
        className="grid h-8 w-8 place-items-center text-muted"
        title={t("player.play")}
      >
        {isLoading && isCurrent ? (
          <Loader2 size={15} className="animate-spin text-accent" />
        ) : isCurrent && isPlaying ? (
          <Pause size={15} className="text-accent" fill="currentColor" />
        ) : (
          <>
            <span className="tnum text-xs group-hover:hidden">
              {index !== undefined ? index + 1 : ""}
            </span>
            <Play
              size={14}
              fill="currentColor"
              className="hidden text-text group-hover:block"
            />
          </>
        )}
      </button>

      {/* Kapak */}
      <div className="grid h-10 w-10 place-items-center overflow-hidden rounded bg-surface-3 text-faint">
        {track.thumbnail ? (
          <img
            src={track.thumbnail}
            alt=""
            loading="lazy"
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <Music2 size={16} />
        )}
      </div>

      {/* Başlık + sanatçı */}
      <div className="min-w-0">
        <div
          className={`truncate text-sm ${isCurrent ? "text-accent" : "text-text"}`}
        >
          {track.title}
        </div>
        <div className="truncate text-xs text-muted">{track.artist}</div>
      </div>

      {/* Aksiyonlar + süre */}
      <div className="flex items-center gap-2 pr-1">
        {trailing}
        <AddToPlaylistButton track={track} />
        <button
          onClick={handleDownloadClick}
          title={
            downloading
              ? t("player.downloading")
              : downloaded
              ? t("player.downloadedClick")
              : t("player.download")
          }
          className={`grid h-7 w-7 place-items-center transition-colors ${
            downloaded
              ? "text-up"
              : downloading
              ? "text-accent"
              : "text-faint opacity-0 hover:text-text group-hover:opacity-100"
          }`}
        >
          {downloading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : downloaded ? (
            <CircleCheck size={16} />
          ) : (
            <Download size={15} />
          )}
        </button>
        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title={t("playlist.removeFromList")}
            className="grid h-7 w-7 place-items-center text-faint opacity-0 transition-colors hover:text-down group-hover:opacity-100"
          >
            <X size={15} />
          </button>
        )}
        <span className="tnum w-10 text-right text-xs text-muted">
          {formatMs(track.durationMs)}
        </span>
      </div>
    </div>
    </>
  );
}
