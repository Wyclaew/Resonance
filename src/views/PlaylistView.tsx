import { useEffect, useRef, useState } from "react";
import {
  Play,
  ListMusic,
  Pencil,
  Trash2,
  Check,
  Flame,
  ListOrdered,
  Share2,
  Copy,
  DownloadCloud,
  CircleCheck,
  Loader2,
  Search,
  X,
  ChevronDown,
  Shuffle,
  Sparkles,
} from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import TrackRow from "../components/TrackRow";
import KarmaControl from "../components/KarmaControl";
import type { Playlist, PlaylistTrack } from "../types";
import { encodePlaylist } from "../lib/share";
import { useLibraryStore } from "../store/useLibraryStore";
import { useT } from "../lib/i18n";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useAppStore } from "../store/useAppStore";
import * as pl from "../lib/playlists";
import { isTauri } from "../lib/db";
import { useToastStore } from "../store/useToastStore";

export default function PlaylistView({ playlistId }: { playlistId: string | null }) {
  const t = useT();
  const [meta, setMeta] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sortMode, setSortMode] = useState<"manual" | "karma">("manual");
  const [query, setQuery] = useState("");
  const dragIndex = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const playNow = usePlayerStore((s) => s.playNow);
  const playShuffled = usePlayerStore((s) => s.playShuffled);
  const startSmartShuffle = usePlayerStore((s) => s.startSmartShuffle);

  const rename = usePlaylistStore((s) => s.rename);
  const removePlaylist = usePlaylistStore((s) => s.remove);
  const removeTrack = usePlaylistStore((s) => s.removeTrack);
  const navigate = useAppStore((s) => s.navigate);
  const downloadMany = useLibraryStore((s) => s.downloadMany);
  const downloadedIds = useLibraryStore((s) => s.downloadedIds);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  const downloadedCount = tracks.filter((t) => downloadedIds.has(t.id)).length;
  const allDownloaded = tracks.length > 0 && downloadedCount === tracks.length;
  const missingCount = tracks.length - downloadedCount;

  async function downloadAll() {
    if (batch) return;
    setBatch({ done: 0, total: missingCount });
    await downloadMany(tracks, (done, total) => setBatch({ done, total }));
    setBatch(null);
  }

  async function load() {
    if (!playlistId || !isTauri()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [m, t] = await Promise.all([
      pl.getPlaylist(playlistId),
      pl.getPlaylistTracks(playlistId),
    ]);
    setMeta(m);
    setTracks(t);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  async function saveName() {
    if (!playlistId) return;
    await rename(playlistId, nameDraft);
    setMeta((m) => (m ? { ...m, name: nameDraft.trim() || m.name } : m));
    setEditing(false);
  }

  async function doDelete() {
    if (!playlistId) return;
    await removePlaylist(playlistId);
    navigate("library");
  }

  async function handleRemoveTrack(trackId: string) {
    if (!playlistId) return;
    setTracks((ts) => ts.filter((t) => t.id !== trackId));
    await removeTrack(playlistId, trackId);
  }

  async function handleVote(track: PlaylistTrack, dir: 1 | -1) {
    if (!playlistId) return;
    const res = await pl.voteTrack(playlistId, track.id, dir);
    if (!res.ok) return; // cooldown — KarmaControl zaten engelliyor
    // Biriken model: taze oyun decay ağırlığı ≈ 1, yani karma += yön.
    setTracks((ts) =>
      ts.map((t) =>
        t.id === track.id
          ? { ...t, karma: t.karma + dir, lastVoteAt: Date.now(), myVote: dir }
          : t
      )
    );
    // "Geri al" — yanlış oy düzeltme.
    const pid = playlistId;
    useToastStore.getState().show(
      dir > 0 ? t("player.liked") : t("player.disliked"),
      "info",
      {
        label: t("player.undo"),
        fn: async () => {
          await pl.undoVote(pid, track.id);
          await load();
        },
      }
    );
  }

  // Görüntüleme sırası: elle (pozisyon) ya da karmaya göre.
  const sorted =
    sortMode === "karma"
      ? [...tracks].sort((a, b) => b.karma - a.karma)
      : tracks;
  // Arama filtresi (başlık/sanatçı).
  const q = query.trim().toLowerCase();
  const displayTracks = q
    ? sorted.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q)
      )
    : sorted;
  // Filtre veya karma sıralaması varken sürükle-bırak kapalı (sıra anlamsızlaşır).
  const canDrag = sortMode === "manual" && !q;

  // --- Sürükle-bırak sıralama (yerel HTML5 DnD) ---
  function onDragStart(i: number) {
    dragIndex.current = i;
    setDragging(i);
  }
  function onDragOver(i: number, e: React.DragEvent) {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === i) return;
    setTracks((ts) => {
      const next = [...ts];
      const [moved] = next.splice(from, 1);
      next.splice(i, 0, moved);
      return next;
    });
    dragIndex.current = i;
    setDragging(i);
  }
  async function onDragEnd() {
    dragIndex.current = null;
    setDragging(null);
    if (playlistId) await pl.reorderPlaylist(playlistId, tracks.map((t) => t.id));
  }

  if (!playlistId) {
    return (
      <div className="flex h-full flex-col">
        <ViewHeader title={t("playlist.title")} />
        <div className="flex flex-1 items-center justify-center text-faint">
          <p className="text-sm">{t("playlist.selectOne")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-end justify-between gap-4 px-8 pb-5 pt-7">
        <div className="min-w-0">
          {editing ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={saveName}
              className="w-full max-w-md rounded-md border border-border-strong bg-surface px-2 py-1 text-2xl font-semibold tracking-tight outline-none"
            />
          ) : (
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {meta?.name ?? t("playlist.title")}
            </h1>
          )}
          <p className="mt-1 text-sm text-muted">
            {t("playlist.trackCount", { count: tracks.length })}
            {meta?.source && meta.source !== "local"
              ? ` · ${meta.source === "spotify" ? "Spotify" : "YouTube Music"}'ten`
              : ""}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <PlayMenu
            disabled={tracks.length === 0}
            onOrdered={() => playNow(tracks[0], tracks, playlistId)}
            onShuffle={() => playShuffled(tracks, playlistId)}
            onSmart={() => void startSmartShuffle(tracks, playlistId)}
          />
          <button
            onClick={downloadAll}
            disabled={tracks.length === 0 || allDownloaded || !!batch}
            title={
              allDownloaded
                ? t("playlist.allDownloaded")
                : t("playlist.downloadAll")
            }
            className={`mr-1 flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
              allDownloaded
                ? "text-up"
                : "text-muted hover:bg-surface hover:text-text"
            }`}
          >
            {batch ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {batch.done}/{batch.total}
              </>
            ) : allDownloaded ? (
              <>
                <CircleCheck size={16} /> {t("playlist.downloadedAll")}
              </>
            ) : (
              <>
                <DownloadCloud size={16} /> {t("playlist.downloadAllBtn")}
              </>
            )}
          </button>
          <button
            onClick={() =>
              setSortMode((m) => (m === "manual" ? "karma" : "manual"))
            }
            title={
              sortMode === "karma"
                ? t("playlist.sortManual")
                : t("playlist.sortByKarma")
            }
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
              sortMode === "karma"
                ? "bg-surface-2 text-accent"
                : "text-muted hover:bg-surface hover:text-text"
            }`}
          >
            {sortMode === "karma" ? (
              <Flame size={15} />
            ) : (
              <ListOrdered size={15} />
            )}
            {sortMode === "karma" ? t("playlist.karma") : t("playlist.order")}
          </button>
          <button
            onClick={() => {
              setNameDraft(meta?.name ?? "");
              setEditing(true);
            }}
            title={t("playlist.rename")}
            className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface hover:text-text"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={() => {
              setCopied(false);
              setShareOpen(true);
            }}
            disabled={tracks.length === 0}
            title={t("playlist.share")}
            className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface hover:text-text disabled:opacity-30"
          >
            <Share2 size={16} />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            title={t("playlist.deleteList")}
            className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface hover:text-down"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {loading ? null : tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-faint">
            <ListMusic size={40} strokeWidth={1.5} />
            <p className="max-w-sm text-center text-sm leading-relaxed">
              {t("playlist.emptyBefore")}
              <span className="text-text">+</span>
              {t("playlist.emptyAfter")}
            </p>
          </div>
        ) : (
          <>
            {tracks.length > 4 && (
              <div
                className="sticky top-0 z-10 mb-2 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 focus-within:border-border-strong"
                /* sticky: uzun listede aşağı kayarken arama çubuğu görünür kalsın
                   (en üste dönmeye gerek yok). Kaydırma kabı bir üstteki
                   overflow-y-auto div; bg-surface şeffaf olmamalı yoksa altındaki
                   satırlar çubuğun içinden geçer. */
              >
                <Search size={15} className="shrink-0 text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("playlist.searchInList")}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="shrink-0 text-faint hover:text-text"
                    title={t("common.clear")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            {displayTracks.length === 0 ? (
              <p className="py-12 text-center text-sm text-faint">
                {t("playlist.noMatchFor", { query })}
              </p>
            ) : (
              displayTracks.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              index={i}
              isCurrent={current?.id === t.id}
              isPlaying={status === "playing"}
              isLoading={status === "loading"}
              onPlay={() => playNow(t, displayTracks, playlistId)}
              onRemove={() => handleRemoveTrack(t.id)}
              draggable={canDrag}
              isDragging={dragging === i}
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(i, e)}
              onDrop={onDragEnd}
              onDragEnd={onDragEnd}
              trailing={
                <KarmaControl
                  karma={t.karma}
                  lastVoteAt={t.lastVoteAt}
                  onVote={(dir) => handleVote(t, dir)}
                />
              }
            />
              ))
            )}
          </>
        )}
      </div>

      {/* Silme onayı */}
      {confirmDelete && (
        <div
          className="absolute inset-0 z-50 grid place-items-center bg-black/50"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="w-80 rounded-lg border border-border bg-surface-2 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">{t("playlist.deleteConfirmTitle")}</h3>
            <p className="mt-1 text-sm text-muted">
              {t("playlist.deleteConfirmBody", { name: meta?.name ?? "" })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-text"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={doDelete}
                className="flex items-center gap-1.5 rounded-md bg-down px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
              >
                <Check size={15} /> Sil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paylaşım kodu */}
      {shareOpen && (
        <div
          className="absolute inset-0 z-50 grid place-items-center bg-black/50"
          onClick={() => setShareOpen(false)}
        >
          <div
            className="w-[28rem] max-w-[90%] rounded-lg border border-border bg-surface-2 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">{t("playlist.shareTitle")}</h3>
            <p className="mt-1 text-sm text-muted">
              {t("playlist.shareDesc")}
            </p>
            <textarea
              readOnly
              value={encodePlaylist(meta?.name ?? t("playlist.untitled"), tracks)}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-3 h-28 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-muted outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setShareOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-text"
              >
                {t("common.close")}
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      encodePlaylist(meta?.name ?? t("playlist.untitled"), tracks)
                    );
                    setCopied(true);
                  } catch {
                    /* pano erişimi yoksa kullanıcı elle seçip kopyalar */
                  }
                }}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
              >
                <Copy size={15} /> {copied ? t("playlist.copied") : t("playlist.copy")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ⭐ ÇALMA ÇEKMECESİ (v1.8.0). Tek "Oynat" düğmesi yerine üç açık seçenek.
//
// NEDEN: eskiden tek düğme vardı ve alt bardaki karışık moduna göre farklı
// davranıyordu — kullanıcı "akıllı karışık açıkken sırayla çaldı" diye
// bildirdi (playNow modu yok sayıyordu). Modu düğmenin İÇİNE almak, gizli
// duruma bağlı sürprizi tamamen kaldırır.
function PlayMenu({
  disabled,
  onOrdered,
  onShuffle,
  onSmart,
}: {
  disabled: boolean;
  onOrdered: () => void;
  onShuffle: () => void;
  onSmart: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={boxRef} className="relative mr-1">
      <div className="flex items-stretch overflow-hidden rounded-full bg-accent text-bg">
        <button
          onClick={onOrdered}
          disabled={disabled}
          title={t("playlist.playOrdered")}
          className="flex items-center gap-2 py-2 pl-4 pr-3 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          <Play size={16} fill="currentColor" /> {t("player.play")}
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          title={t("playlist.playOptions")}
          className="grid w-8 place-items-center border-l border-bg/20 transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          <ChevronDown size={15} />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <PlayOption
            icon={<ListOrdered size={15} />}
            label={t("playlist.playOrdered")}
            hint={t("playlist.playOrderedHint")}
            onClick={() => pick(onOrdered)}
          />
          <PlayOption
            icon={<Shuffle size={15} />}
            label={t("playlist.playShuffled")}
            hint={t("playlist.playShuffledHint")}
            onClick={() => pick(onShuffle)}
          />
          <PlayOption
            icon={<Sparkles size={15} />}
            label={t("playlist.playSmart")}
            hint={t("playlist.playSmartHint")}
            onClick={() => pick(onSmart)}
          />
        </div>
      )}
    </div>
  );
}

function PlayOption({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      <span className="mt-0.5 text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}
