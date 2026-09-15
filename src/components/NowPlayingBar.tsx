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
  PictureInPicture2,
  Download,
  CircleCheck,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { usePlayerStore, DISCOVERY_ID } from "../store/usePlayerStore";
import { useAppStore } from "../store/useAppStore";
import { useLibraryStore } from "../store/useLibraryStore";
import { formatMs } from "../lib/format";
import { isTauri } from "../lib/db";
import { useT } from "../lib/i18n";
import { reasonText } from "../lib/recommender";
import { useSettingsStore } from "../store/useSettingsStore";
import { getTrackKarma } from "../lib/playlists";
import { onRemoteApplied } from "../lib/sync/engine";
import { voteCurrent, KARMA_EVENT, type KarmaEventDetail } from "../lib/vote";
import { toggleMiniPlayer } from "../lib/miniPlayer";
import AddToPlaylistButton from "./AddToPlaylistButton";
import KarmaControl from "./KarmaControl";
import SleepTimerButton from "./SleepTimerButton";

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <VolumeX size={17} />;
  if (volume < 0.5) return <Volume1 size={17} />;
  return <Volume2 size={17} />;
}

export default function NowPlayingBar() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const {
    status,
    current,
    positionMs,
    durationMs,
    volume,
    muted,
    shuffleMode,
    repeat,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    cycleShuffle,
    cycleRepeat,
  } = usePlayerStore();

  const lyricsOpen = useAppStore((s) => s.lyricsOpen);
  const toggleLyrics = useAppStore((s) => s.toggleLyrics);
  const queueOpen = useAppStore((s) => s.queueOpen);
  const toggleQueue = useAppStore((s) => s.toggleQueue);
  const radioPlaylistId = usePlayerStore((s) => s.radioPlaylistId);
  const inDiscovery = radioPlaylistId === DISCOVERY_ID;
  const showQueueButton = !inDiscovery && shuffleMode !== "off";
  const navigate = useAppStore((s) => s.navigate);

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
    const load = () => {
      if (playlistId && current?.id && isTauri()) {
        getTrackKarma(playlistId, current.id)
          .then((k) => setKarma({ karma: k.karma, lastVoteAt: k.lastVoteAt }))
          .catch(() => setKarma(null));
      } else {
        setKarma(null);
      }
    };
    load();
    // ⛔ BUG'DI (v1.9.3): diğer cihazdan senkronla gelen oy, şarkı değişene
    // kadar görünmüyordu — kullanıcı "Mac'te verdiğim oy Windows'ta yok" dedi,
    // oy aslında gelmişti. Uzak veri uygulanınca yeniden oku.
    return onRemoteApplied(load);
  }, [current?.id, playlistId]);

  // Mini oynatıcıdan (ya da başka bir yoldan) oy verilirse gösterge tazelensin.
  // Oy PARÇAYA aittir (v1.9.2) → hangi listeden verildiğine bakılmaz.
  useEffect(() => {
    function onKarma(e: Event) {
      const d = (e as CustomEvent<KarmaEventDetail>).detail;
      if (d.trackId !== current?.id) return;
      setKarma({ karma: d.karma, lastVoteAt: d.lastVoteAt });
    }
    window.addEventListener(KARMA_EVENT, onKarma);
    return () => window.removeEventListener(KARMA_EVENT, onKarma);
  }, [current?.id, playlistId]);

  async function handleVote(dir: 1 | -1) {
    // Ortak yol: `src/lib/vote.ts` (ensureTrack + cooldown + geri al).
    await voteCurrent(dir, setKarma);
  }

  const isPlaying = status === "playing";
  const pct = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;

  return (
    <footer className="relative isolate flex h-20 shrink-0 items-center gap-4 overflow-hidden border-t border-border bg-surface px-4">
      {/* Çalan kapağın çok hafif, bulanık yansıması — mini oynatıcıyla aynı dil. */}
      {current?.thumbnail && (
        <img
          aria-hidden
          src={current.thumbnail}
          alt=""
          draggable={false}
          className="pointer-events-none absolute -left-10 top-1/2 -z-10 h-64 w-[36rem] -translate-y-1/2 object-cover opacity-[0.16] blur-3xl saturate-150"
        />
      )}
      {/* Sol: şu an çalan */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          onClick={() =>
            current &&
            navigate(
              current.playlistId ? "playlist" : "now",
              current.playlistId
            )
          }
          title={current ? t("player.goToPlaying") : undefined}
          className={`grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-3 text-faint shadow-lg shadow-black/30 transition-transform hover:scale-[1.03] ${
            current
              ? "cursor-pointer ring-2 ring-accent/60"
              : "ring-1 ring-white/5"
          }`}
        >
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
              title={reasonText(current.recReason, lang)}
            >
              <Sparkles size={11} />
              <span className="truncate">
                {t("rec.badge")}
                {current.recReason
                  ? ` · ${reasonText(current.recReason, lang)}`
                  : ""}
              </span>
            </div>
          )}
          <div className="truncate text-sm font-medium">
            {current?.title ?? t("player.notPlaying")}
          </div>
          <div className="truncate text-xs text-muted">
            {current?.artist ?? t("player.searchAndPlay")}
          </div>
        </div>
        {current?.isRecommendation && (
          <AddToPlaylistButton track={current} always openUp />
        )}
        {karma && (
          <span data-tour="vote">
            <KarmaControl
              karma={karma.karma}
              lastVoteAt={karma.lastVoteAt}
              onVote={handleVote}
            />
          </span>
        )}
      </div>

      {/* Orta: kontroller + ilerleme */}
      <div className="flex max-w-2xl flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-4">
          <button
            onClick={cycleShuffle}
            title={
              shuffleMode === "off"
                ? t("player.shuffleOff")
                : shuffleMode === "shuffle"
                ? t("player.shuffleOn")
                : t("player.shuffleSmart")
            }
            className={`relative ${
              shuffleMode === "off"
                ? "text-muted hover:text-text"
                : "text-accent"
            }`}
          >
            <Shuffle size={16} />
            {shuffleMode === "smart" && (
              <Sparkles
                size={9}
                className="absolute -right-1.5 -top-1 text-accent"
                fill="currentColor"
              />
            )}
          </button>
          <button
            onClick={prev}
            title={t("player.previous")}
            className="text-muted hover:text-text"
          >
            <SkipBack size={19} />
          </button>
          <button
            onClick={toggle}
            disabled={!current}
            className="grid h-9 w-9 place-items-center rounded-full bg-text text-bg transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
            title={isPlaying ? t("player.pause") : t("player.play")}
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="ml-0.5" />
            )}
          </button>
          <button
            onClick={() => next()}
            title={t("player.next")}
            className="text-muted hover:text-text"
          >
            <SkipForward size={19} />
          </button>
          <button
            onClick={cycleRepeat}
            title={
              repeat === "off"
                ? t("player.repeatOff")
                : repeat === "all"
                ? t("player.repeatAll")
                : t("player.repeatOne")
            }
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
                ? t("player.downloading")
                : downloaded
                ? t("player.downloaded")
                : t("player.download")
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
        {/* ⭐ SIRA DÜĞMESİ KOŞULLU (v1.8.0).
            • Keşfet'te GİZLİ: sıra zaten Keşfet sayfasının kendisi; buradan
              açılan panel ikinci bir (eski) keşfet arayüzü gibi davranıyordu.
            • Sıralı çalmada GİZLİ: listeyi zaten görüyorsun.
            • Yalnız karışık / akıllı karışıkta görünür — sıradakinin ne
              olduğu orada gerçekten bilinmiyor. */}
        {showQueueButton && (
          <button
            onClick={toggleQueue}
            title={t("player.queue")}
            className={queueOpen ? "text-accent" : "text-muted hover:text-text"}
          >
            <ListMusic size={16} />
          </button>
        )}
        <button
          onClick={() => void toggleMiniPlayer()}
          title={t("player.miniPlayer")}
          className="text-muted hover:text-text"
        >
          <PictureInPicture2 size={16} />
        </button>
        <button
          onClick={toggleLyrics}
          title={t("player.lyrics")}
          className={lyricsOpen ? "text-accent" : "text-muted hover:text-text"}
        >
          <ScrollText size={16} />
        </button>
        <SleepTimerButton />
        <button
          onClick={toggleMute}
          className="text-muted hover:text-text"
          title={muted ? t("player.unmute") : t("player.mute")}
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
