import { useEffect, useRef, useState } from "react";
import {
  Play,
  ListMusic,
  Pencil,
  Trash2,
  Check,
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
  ArrowDownUp,
  CheckSquare,
  Plus,
  Folder as FolderIcon,
} from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import Mosaic from "../components/Mosaic";
import TrackRow from "../components/TrackRow";
import KarmaControl from "../components/KarmaControl";
import type { Playlist, PlaylistTrack } from "../types";
import type { TrKey } from "../lib/i18n";
import { encodePlaylist } from "../lib/share";
import { useLibraryStore } from "../store/useLibraryStore";
import { useT } from "../lib/i18n";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useAppStore } from "../store/useAppStore";
import * as pl from "../lib/playlists";
import { isTauri } from "../lib/db";
import { useWindowedList } from "../lib/useWindowedList";
import { onRemoteApplied } from "../lib/sync/engine";
import { KARMA_EVENT } from "../lib/vote";
import { LIBRARY_CHANGED_EVENT } from "../lib/placeholderRepair";
import { useToastStore } from "../store/useToastStore";

type SortMode =
  | "manual"
  | "karma"
  | "title"
  | "artist"
  | "addedNew"
  | "addedOld"
  | "duration";

const SORT_MODES: SortMode[] = [
  "manual",
  "karma",
  "title",
  "artist",
  "addedNew",
  "addedOld",
  "duration",
];

const SORT_LABELS: Record<SortMode, TrKey> = {
  manual: "playlist.sortManualShort",
  karma: "playlist.karma",
  title: "playlist.sortTitleAz",
  artist: "playlist.sortArtistAz",
  addedNew: "playlist.sortAddedNew",
  addedOld: "playlist.sortAddedOld",
  duration: "playlist.sortDuration",
};

/** Görüntüleme sırası — DB'deki sırayı DEĞİŞTİRMEZ (elle sıra korunur). */
function applySort(tracks: PlaylistTrack[], mode: SortMode): PlaylistTrack[] {
  if (mode === "manual") return tracks;
  const byText = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  const copy = [...tracks];
  switch (mode) {
    case "karma":
      return copy.sort((a, b) => b.karma - a.karma);
    case "title":
      return copy.sort((a, b) => byText(a.title, b.title));
    case "artist":
      return copy.sort((a, b) => byText(a.artist, b.artist) || byText(a.title, b.title));
    case "addedNew":
      return copy.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    case "addedOld":
      return copy.sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
    case "duration":
      return copy.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
    default:
      return copy;
  }
}

/** Seçili parçaları başka bir listeye ekler (toplu). */
function MultiAddToPlaylist({
  tracks,
  onDone,
}: {
  tracks: PlaylistTrack[];
  onDone: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const playlists = usePlaylistStore((s) => s.playlists);
  const addTrack = usePlaylistStore((s) => s.addTrack);
  const toast = useToastStore((s) => s.show);

  const add = async (id: string, name: string) => {
    setOpen(false);
    let n = 0;
    for (const tr of tracks) {
      const ok = await addTrack(id, tr);
      if (ok) n++;
    }
    toast(t("playlist.selectedAdded", { n, name }), "success");
    onDone();
  };

  return (
    <div className="relative">
      <button
        disabled={tracks.length === 0}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1 text-xs text-text disabled:opacity-40"
      >
        <Plus size={13} /> {t("playlist.selectedAdd")}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="animate-pop-in absolute left-0 z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-surface/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
            {playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => void add(p.id, p.name)}
                className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Listeyi klasöre taşı: var olanlardan seç ya da yeni klasör adı yaz. */
function FolderMenu({
  current,
  folders,
  onPick,
}: {
  current?: string;
  folders: string[];
  onPick: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("playlist.folder")}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
          current ? "bg-surface-2 text-accent" : "text-muted hover:bg-surface hover:text-text"
        }`}
      >
        <FolderIcon size={15} />
        <span className="max-w-[8rem] truncate">{current || t("playlist.folder")}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="animate-pop-in absolute right-0 z-50 mt-1 w-60 origin-top-right rounded-xl border border-border bg-surface/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <button
              onClick={() => {
                setOpen(false);
                void onPick("");
              }}
              className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
            >
              {t("playlist.folderNone")}
            </button>
            {folders.map((f) => (
              <button
                key={f}
                onClick={() => {
                  setOpen(false);
                  void onPick(f);
                }}
                className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 ${
                  f === current ? "text-accent" : ""
                }`}
              >
                {f}
              </button>
            ))}
            <div className="mt-1 flex items-center gap-1.5 border-t border-border pt-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim()) {
                    setOpen(false);
                    void onPick(draft.trim());
                    setDraft("");
                  }
                }}
                placeholder={t("playlist.folderNew")}
                className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
              />
              <button
                disabled={!draft.trim()}
                onClick={() => {
                  setOpen(false);
                  void onPick(draft.trim());
                  setDraft("");
                }}
                className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-bg disabled:opacity-40"
              >
                {t("common.add")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
  // ⭐ SIRALAMA (v1.9.6): eskiden yalnız "elle ↔ karma" iki durumluydu.
  // ⚠️ "Çıkış tarihi" YOK: YouTube'dan gelen parçalarda yayın tarihi
  // tutulmuyor (ayrı bir istek gerektirirdi) — en yakın karşılığı "eklenme".
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [sortOpen, setSortOpen] = useState(false);
  // Çoklu seçim: kip açıkken satıra tıklamak seçer, Shift aralık seçer.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastPicked = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const allPlaylists = usePlaylistStore((s) => s.playlists);
  const refreshPlaylists = usePlaylistStore((s) => s.refresh);
  const folders = [
    ...new Set(allPlaylists.map((p) => (p.folder ?? "").trim()).filter(Boolean)),
  ].sort();
  const removeTrack = usePlaylistStore((s) => s.removeTrack);
  const navigate = useAppStore((s) => s.navigate);
  const downloadMany = useLibraryStore((s) => s.downloadMany);
  const downloadedIds = useLibraryStore((s) => s.downloadedIds);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  const downloadedCount = tracks.filter((t) => downloadedIds.has(t.id)).length;
  const totalMinutes = Math.round(
    tracks.reduce((sum, tr) => sum + (tr.durationMs ?? 0), 0) / 60000
  );
  const covers = tracks
    .map((tr) => tr.thumbnail)
    .filter((x): x is string => !!x)
    .slice(0, 4);
  const allDownloaded = tracks.length > 0 && downloadedCount === tracks.length;
  const missingCount = tracks.length - downloadedCount;

  async function downloadAll() {
    if (batch) return;
    setBatch({ done: 0, total: missingCount });
    await downloadMany(tracks, (done, total) => setBatch({ done, total }));
    setBatch(null);
  }

  async function load(silent = false) {
    if (!playlistId || !isTauri()) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
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
    // ⛔ BUG'DI (v1.9.3): açık liste sayfası diğer cihazdan gelen parçaları ve
    // oyları, alt bardan verilen oyu da GÖSTERMİYORDU — sayfadan çıkıp girmek
    // gerekiyordu ("Mac'te 240, Windows'ta 241" karşılaştırmasını da yanıltır).
    // Sessiz yeniden yükleme: kaydırma konumu ve arama korunur.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(true), 300);
    };
    const off = onRemoteApplied(reload);
    window.addEventListener(KARMA_EVENT, reload);
    window.addEventListener(LIBRARY_CHANGED_EVENT, reload);
    return () => {
      off();
      window.removeEventListener(KARMA_EVENT, reload);
      window.removeEventListener(LIBRARY_CHANGED_EVENT, reload);
      if (timer) clearTimeout(timer);
    };
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

  /**
   * ⭐ ÇIKARMA GERİ ALINABİLİR (v1.9.6): kullanıcının en büyük korkusu
   * "şarkılar habersiz kayboluyor". Silme zaten tombstone (satır durur), bu
   * yüzden geri almak listeyi eski hâline döndürür — pozisyonuyla birlikte.
   */
  async function handleRemoveTrack(trackId: string) {
    if (!playlistId) return;
    const removed = tracks.find((x) => x.id === trackId);
    const at = tracks.findIndex((x) => x.id === trackId);
    setTracks((ts) => ts.filter((t) => t.id !== trackId));
    await removeTrack(playlistId, trackId);
    if (!removed) return;
    useToastStore.getState().show(
      t("playlist.removedOne", { title: removed.title }),
      "info",
      {
        label: t("player.undo"),
        fn: async () => {
          await pl.addTrackToPlaylist(playlistId, removed);
          if (at >= 0) {
            const next = [...tracks];
            next.splice(at, 0, removed);
            await pl.reorderPlaylist(playlistId, next.map((x) => x.id));
          }
          await load(true);
        },
      },
      8000
    );
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

  // Görüntüleme sırası.
  const sorted = applySort(tracks, sortMode);
  // Arama filtresi (başlık/sanatçı).
  const q = query.trim().toLowerCase();
  const displayTracks = q
    ? sorted.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q)
      )
    : sorted;
    // Uzun listelerde yalnız görünen satırlar çizilir (bkz. useWindowedList).
  const win = useWindowedList(scrollRef, displayTracks.length);

  // ── Çoklu seçim yardımcıları ───────────────────────────────────────────
  const toggleSelect = (idx: number, id: string, e: React.MouseEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      // Shift: son seçilenden buraya kadar olan ARALIK (dosya yöneticisi gibi).
      if (e.shiftKey && lastPicked.current !== null) {
        const [a, b] = [lastPicked.current, idx].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) {
          const t = displayTracks[i];
          if (t) next.add(t.id);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastPicked.current = idx;
  };

  const selectedTracks = () => displayTracks.filter((t) => selected.has(t.id));

  async function removeSelected() {
    if (!playlistId) return;
    const list = selectedTracks();
    const before = [...tracks];
    for (const tr of list) await removeTrack(playlistId, tr.id);
    setSelected(new Set());
    await load(true);
    useToastStore.getState().show(
      t("playlist.selectedRemoved", { n: list.length }),
      "success",
      {
        label: t("player.undo"),
        fn: async () => {
          for (const tr of list) await pl.addTrackToPlaylist(playlistId, tr);
          await pl.reorderPlaylist(playlistId, before.map((x) => x.id));
          await load(true);
        },
      },
      8000
    );
  }

  async function downloadSelected() {
    const list = selectedTracks().filter((tr) => !downloadedIds.has(tr.id));
    if (list.length === 0) return;
    setBatch({ done: 0, total: list.length });
    await downloadMany(list, (done, total) => setBatch({ done, total }));
    setBatch(null);
    setSelected(new Set());
  }

// Filtre veya karma sıralaması varken sürükle-bırak kapalı (sıra anlamsızlaşır).
  const canDrag = sortMode === "manual" && !q && !selectMode;

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
        {/* Kapak mozaiği + başlık: liste sayfası artık kimliği olan bir sayfa. */}
        <div className="flex min-w-0 items-end gap-4">
          <Mosaic covers={covers} size={88} rounded="rounded-xl" />
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
            <h1 className="font-display truncate text-[28px] font-semibold leading-tight">
              {meta?.name ?? t("playlist.title")}
            </h1>
          )}
          <p className="mt-1 text-sm text-muted">
            {t("playlist.trackCount", { count: tracks.length })}
            {totalMinutes > 0 ? ` · ${t("playlist.totalMinutes", { n: totalMinutes })}` : ""}
            {downloadedCount > 0
              ? ` · ${t("playlist.downloadedCount", { n: downloadedCount })}`
              : ""}
            {meta?.source && meta.source !== "local"
              ? ` · ${meta.source === "spotify" ? "Spotify" : "YouTube Music"}'ten`
              : ""}
          </p>
        </div>
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
          <div className="relative">
            <button
              onClick={() => setSortOpen((v) => !v)}
              title={t("playlist.sortTitle")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                sortMode === "manual"
                  ? "text-muted hover:bg-surface hover:text-text"
                  : "bg-surface-2 text-accent"
              }`}
            >
              <ArrowDownUp size={15} />
              {t(SORT_LABELS[sortMode])}
            </button>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />
                <div className="animate-pop-in absolute right-0 z-50 mt-1 w-56 origin-top-right overflow-hidden rounded-xl border border-border bg-surface/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
                  {SORT_MODES.map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setSortMode(m);
                        setSortOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 ${
                        sortMode === m ? "text-accent" : "text-text"
                      }`}
                    >
                      {t(SORT_LABELS[m])}
                      {sortMode === m && <Check size={14} />}
                    </button>
                  ))}
                  <p className="px-2.5 pb-1 pt-2 text-[11px] leading-relaxed text-faint">
                    {t("playlist.sortNote")}
                  </p>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            title={t("playlist.selectMode")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
              selectMode
                ? "bg-surface-2 text-accent"
                : "text-muted hover:bg-surface hover:text-text"
            }`}
          >
            <CheckSquare size={15} />
            {t("playlist.selectMode")}
          </button>
          <FolderMenu
            current={meta?.folder}
            folders={folders}
            onPick={async (name) => {
              if (!playlistId) return;
              await pl.setPlaylistFolder(playlistId, name);
              setMeta((m) => (m ? { ...m, folder: name || undefined } : m));
              await refreshPlaylists();
            }}
          />
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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
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
            {selectMode && (
              <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-surface px-3 py-2 shadow-lg shadow-black/20">
                <span className="text-sm font-medium text-accent">
                  {t("playlist.selectedCount", { n: selected.size })}
                </span>
                <button
                  onClick={() => setSelected(new Set(displayTracks.map((x) => x.id)))}
                  className="rounded-md bg-surface-2 px-2.5 py-1 text-xs text-text"
                >
                  {t("playlist.selectAll")}
                </button>
                <span className="mx-1 h-4 w-px bg-border" />
                <button
                  disabled={selected.size === 0 || !!batch}
                  onClick={() => void downloadSelected()}
                  className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1 text-xs text-text disabled:opacity-40"
                >
                  <DownloadCloud size={13} /> {t("playlist.selectedDownload")}
                </button>
                <MultiAddToPlaylist
                  tracks={selectedTracks()}
                  onDone={() => setSelected(new Set())}
                />
                <button
                  disabled={selected.size === 0}
                  onClick={() => void removeSelected()}
                  className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1 text-xs text-down disabled:opacity-40"
                >
                  <Trash2 size={13} /> {t("playlist.selectedRemove")}
                </button>
                <button
                  onClick={() => {
                    setSelectMode(false);
                    setSelected(new Set());
                  }}
                  className="ml-auto text-xs text-muted hover:text-text"
                >
                  {t("playlist.selectClear")}
                </button>
              </div>
            )}
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
              <>
                {win.padTop > 0 && <div style={{ height: win.padTop }} />}
                {displayTracks.slice(win.start, win.end).map((t, idx) => {
                  const i = win.start + idx;
                  return (
            <TrackRow
              key={t.id}
              track={t}
              index={i}
              isCurrent={current?.id === t.id}
              isPlaying={status === "playing"}
              isLoading={status === "loading"}
              selectable={selectMode}
              selected={selected.has(t.id)}
              onToggleSelect={(e) => toggleSelect(i, t.id, e)}
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
                  );
                })}
                {win.padBottom > 0 && <div style={{ height: win.padBottom }} />}
              </>
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
