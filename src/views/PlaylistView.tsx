import { useEffect, useRef, useState } from "react";
import {
  Play,
  ListMusic,
  Pencil,
  Trash2,
  Check,
  Flame,
  ListOrdered,
  Radio,
  Share2,
  Copy,
  DownloadCloud,
  CircleCheck,
  Loader2,
  Search,
  X,
} from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import TrackRow from "../components/TrackRow";
import KarmaControl from "../components/KarmaControl";
import type { Playlist, PlaylistTrack } from "../types";
import { encodePlaylist } from "../lib/share";
import { useLibraryStore } from "../store/useLibraryStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useAppStore } from "../store/useAppStore";
import * as pl from "../lib/playlists";
import { isTauri } from "../lib/db";

export default function PlaylistView({ playlistId }: { playlistId: string | null }) {
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
  const startRadio = usePlayerStore((s) => s.startRadio);

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
        <ViewHeader title="Çalma Listesi" />
        <div className="flex flex-1 items-center justify-center text-faint">
          <p className="text-sm">Bir çalma listesi seç.</p>
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
              {meta?.name ?? "Çalma Listesi"}
            </h1>
          )}
          <p className="mt-1 text-sm text-muted">
            {tracks.length} şarkı
            {meta?.source && meta.source !== "local"
              ? ` · ${meta.source === "spotify" ? "Spotify" : "YouTube Music"}'ten`
              : ""}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => tracks.length && playNow(tracks[0], tracks)}
            disabled={tracks.length === 0}
            title="Hepsini oynat"
            className="mr-1 flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition-transform hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
          >
            <Play size={16} fill="currentColor" /> Oynat
          </button>
          <button
            onClick={() => tracks.length && startRadio(tracks, playlistId)}
            disabled={tracks.length === 0}
            title="Resonance Radyosu — karma sıralı, araya öneriler"
            className="mr-1 flex items-center gap-2 rounded-full border border-accent/50 px-3.5 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-30"
          >
            <Radio size={16} /> Radyo
          </button>
          <button
            onClick={downloadAll}
            disabled={tracks.length === 0 || allDownloaded || !!batch}
            title={
              allDownloaded
                ? "Tüm şarkılar indirildi"
                : "Tümünü çevrimdışı için indir (indirilenleri atlar)"
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
                <CircleCheck size={16} /> İndirildi
              </>
            ) : (
              <>
                <DownloadCloud size={16} /> Tümünü indir
              </>
            )}
          </button>
          <button
            onClick={() =>
              setSortMode((m) => (m === "manual" ? "karma" : "manual"))
            }
            title={
              sortMode === "karma"
                ? "Karmaya göre sıralı — elle sıraya dön"
                : "Elle sıralı — karmaya göre sırala"
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
            {sortMode === "karma" ? "Karma" : "Sıra"}
          </button>
          <button
            onClick={() => {
              setNameDraft(meta?.name ?? "");
              setEditing(true);
            }}
            title="Yeniden adlandır"
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
            title="Paylaş"
            className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface hover:text-text disabled:opacity-30"
          >
            <Share2 size={16} />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            title="Listeyi sil"
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
              Bu liste boş. Arama sonuçlarında veya başka bir listede şarkıların
              yanındaki <span className="text-text">+</span> ile buraya ekle.
            </p>
          </div>
        ) : (
          <>
            {tracks.length > 4 && (
              <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 focus-within:border-border-strong">
                <Search size={15} className="shrink-0 text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Bu listede ara…"
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="shrink-0 text-faint hover:text-text"
                    title="Temizle"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            {displayTracks.length === 0 ? (
              <p className="py-12 text-center text-sm text-faint">
                "{query}" için sonuç yok.
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
            <h3 className="text-base font-semibold">Listeyi sil?</h3>
            <p className="mt-1 text-sm text-muted">
              "{meta?.name}" kalıcı olarak silinecek. Şarkılar silinmez.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-text"
              >
                Vazgeç
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
            <h3 className="text-base font-semibold">Çalma listesini paylaş</h3>
            <p className="mt-1 text-sm text-muted">
              Bu kodu kopyalayıp paylaş. Karşı taraf "İçe Aktar"a yapıştırıp
              listenin kopyasını alır.
            </p>
            <textarea
              readOnly
              value={encodePlaylist(meta?.name ?? "Liste", tracks)}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-3 h-28 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-muted outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setShareOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-text"
              >
                Kapat
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      encodePlaylist(meta?.name ?? "Liste", tracks)
                    );
                    setCopied(true);
                  } catch {
                    /* pano erişimi yoksa kullanıcı elle seçip kopyalar */
                  }
                }}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
              >
                <Copy size={15} /> {copied ? "Kopyalandı" : "Kopyala"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
