import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Volume1,
  Music2,
  Sparkles,
  ScrollText,
  ListMusic,
  Download,
  CircleCheck,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { usePlayerStore } from "../store/usePlayerStore";
import { useAppStore } from "../store/useAppStore";
import { useToastStore } from "../store/useToastStore";
import { useLibraryStore } from "../store/useLibraryStore";
import { formatMs } from "../lib/format";
import { isTauri } from "../lib/db";
import { getTrackKarma, voteTrack } from "../lib/playlists";
import AddToPlaylistButton from "./AddToPlaylistButton";
import KarmaControl from "./KarmaControl";
import SleepTimerButton from "./SleepTimerButton";

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <VolumeX size={17} />;
  if (volume < 0.5) return <Volume1 size={17} />;
  return <Volume2 size={17} />;
}

export default function NowPlayingBar() {
  const {
    status,
    current,
    positionMs,
    durationMs,
    volume,
    muted,
    shuffle,
    repeat,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
  } = usePlayerStore();

  const lyricsOpen = useAppStore((s) => s.lyricsOpen);
  const toggleLyrics = useAppStore((s) => s.toggleLyrics);
  const queueOpen = useAppStore((s) => s.queueOpen);
  const toggleQueue = useAppStore((s) => s.toggleQueue);
  const showToast = useToastStore((s) => s.show);

  // Çalan şarkının indirme durumu (alt bardan indir/kaldır).
  const downloaded = useLibraryStore((s) =>
    current ? s.downloadedIds.has(current.id) : false
  );
  const downloading = useLibraryStore((s) =>
    current ? s.downloadingIds.has(current.id) : false
  );
  const downloadTrack = useLibraryStore((s) => s.download);
  const removeTrack = useLibraryStore((s) => s.remove);

  // Çalan şarkının (bir liste bağlamındaysa) karma bilgisi — alt baradan oylama.
  const [karma, setKarma] = useState<{ karma: number; lastVoteAt?: number } | null>(
    null
  );
  const playlistId = current?.playlistId;
  useEffect(() => {
    if (playlistId && current?.id && isTauri()) {
      getTrackKarma(playlistId, current.id)
        .then((k) => setKarma({ karma: k.karma, lastVoteAt: k.lastVoteAt }))
        .catch(() => setKarma(null));
    } else {
      setKarma(null);
    }
  }, [current?.id, playlistId]);

  async function handleVote(dir: 1 | -1) {
    if (!playlistId || !current?.id) return;
    try {
      const res = await voteTrack(playlistId, current.id, dir);
      if (!res.ok) {
        const mins = Math.ceil(res.cooldownRemainingMs / 60_000);
        showToast(`Bu şarkı için ${mins} dk sonra tekrar oy verebilirsin`, "info");
        return;
      }
      const k = await getTrackKarma(playlistId, current.id);
      setKarma({ karma: k.karma, lastVoteAt: k.lastVoteAt });
    } catch {
      /* yoksay */
    }
  }

  const isPlaying = status === "playing";
  const pct = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;

  return (
    <footer className="flex h-20 shrink-0 items-center gap-4 border-t border-border bg-surface px-4">
      {/* Sol: şu an çalan */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-3 text-faint shadow-lg shadow-black/30 ring-1 ring-white/5 transition-transform hover:scale-[1.03]">
          {current?.thumbnail ? (
            <img
              src={current.thumbnail}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <Music2 size={22} />
          )}
        </div>
        <div className="min-w-0">
          {current?.isRecommendation && (
            <div
              className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent"
              title={current.recReason}
            >
              <Sparkles size={11} />
              <span className="truncate">
                Resonance önerisi
                {current.recReason ? ` · ${current.recReason}` : ""}
              </span>
            </div>
          )}
          <div className="truncate text-sm font-medium">
            {current?.title ?? "Çalmıyor"}
          </div>
          <div className="truncate text-xs text-muted">
            {current?.artist ?? "Bir şarkı ara ve oynat"}
          </div>
        </div>
        {current?.isRecommendation && (
          <AddToPlaylistButton track={current} always openUp />
        )}
        {karma && (
          <KarmaControl
            karma={karma.karma}
            lastVoteAt={karma.lastVoteAt}
            onVote={handleVote}
          />
        )}
      </div>

      {/* Orta: kontroller + ilerleme */}
      <div className="flex max-w-2xl flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-4">
          <button
            onClick={toggleShuffle}
            title="Karıştır"
            className={shuffle ? "text-accent" : "text-muted hover:text-text"}
          >
            <Shuffle size={16} />
          </button>
          <button
            onClick={prev}
            title="Önceki"
            className="text-muted hover:text-text"
          >
            <SkipBack size={19} />
          </button>
          <button
            onClick={toggle}
            disabled={!current}
            className="grid h-9 w-9 place-items-center rounded-full bg-text text-bg transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
            title={isPlaying ? "Duraklat" : "Oynat"}
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="ml-0.5" />
            )}
          </button>
          <button
            onClick={next}
            title="Sonraki"
            className="text-muted hover:text-text"
          >
            <SkipForward size={19} />
          </button>
          <button
            onClick={cycleRepeat}
            title="Tekrar"
            className={repeat !== "off" ? "text-accent" : "text-muted hover:text-text"}
          >
            {repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>
        </div>

        <div className="flex w-full items-center gap-2">
          <span className="tnum w-10 text-right text-[11px] text-muted">
            {formatMs(positionMs)}
          </span>
          <input
            type="range"
            min={0}
            max={durationMs || 0}
            value={positionMs}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!current}
            className="resonance-range flex-1"
            style={{ ["--pct" as string]: `${pct}%` }}
          />
          <span className="tnum w-10 text-[11px] text-muted">
            {formatMs(durationMs)}
          </span>
        </div>
      </div>

      {/* Sağ: indir, sıra, sözler, uyku, ses */}
      <div className="flex flex-1 items-center justify-end gap-3">
        {current && (
          <button
            onClick={() =>
              downloading
                ? undefined
                : downloaded
                ? removeTrack(current)
                : downloadTrack(current)
            }
            title={
              downloading
                ? "İndiriliyor…"
                : downloaded
                ? "İndirildi — kaldır"
                : "İndir"
            }
            className={
              downloaded
                ? "text-up"
                : downloading
                ? "text-accent"
                : "text-muted hover:text-text"
            }
          >
            {downloading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : downloaded ? (
              <CircleCheck size={16} />
            ) : (
              <Download size={16} />
            )}
          </button>
        )}
        <button
          onClick={toggleQueue}
          title="Sıra"
          className={queueOpen ? "text-accent" : "text-muted hover:text-text"}
        >
          <ListMusic size={16} />
        </button>
        <button
          onClick={toggleLyrics}
          title="Sözler"
          className={lyricsOpen ? "text-accent" : "text-muted hover:text-text"}
        >
          <ScrollText size={16} />
        </button>
        <SleepTimerButton />
        <button
          onClick={toggleMute}
          className="text-muted hover:text-text"
          title="Sessize al"
        >
          <VolumeIcon volume={volume} muted={muted} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="resonance-range w-24"
          style={{ ["--pct" as string]: `${(muted ? 0 : volume) * 100}%` }}
        />
      </div>
    </footer>
  );
}
