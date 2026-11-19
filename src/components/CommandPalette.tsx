import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  Sparkles,
  Library,
  Download,
  Import,
  Settings,
  ListMusic,
  CornerDownLeft,
  Brain,
  BarChart3,
  Music2,
} from "lucide-react";
import type { ViewId } from "../types";
import { useAppStore } from "../store/useAppStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useT, type TrKey } from "../lib/i18n";
import { searchLibrary, playlistsHint, type LibraryHit } from "../lib/librarySearch";

// Komut paleti (Cmd/Ctrl+K) — görünümler ve çalma listeleri arasında klavyeyle
// hızlı gezinme. Yaz → filtrele, ok tuşları → seç, Enter → git, Esc → kapat.
interface Cmd {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  run: () => void;
  /** Kütüphane şarkısı grubu (başlık gösterilir). */
  library?: boolean;
  /** Shift+Enter: sıradakine ekle (yalnız kütüphane şarkıları). */
  runNext?: () => void;
}

// label çeviri ANAHTARI (metin değil) — dil değişince paletteki adlar da değişsin.
const VIEWS: { view: ViewId; labelKey: TrKey; icon: typeof Search }[] = [
  { view: "now", labelKey: "nav.now", icon: Sparkles },
  { view: "search", labelKey: "nav.search", icon: Search },
  { view: "library", labelKey: "nav.library", icon: Library },
  { view: "downloads", labelKey: "nav.downloads", icon: Download },
  { view: "import", labelKey: "nav.import", icon: Import },
  { view: "taste", labelKey: "profile.taste", icon: Brain },
  { view: "stats", labelKey: "profile.stats", icon: BarChart3 },
  { view: "settings", labelKey: "nav.settings", icon: Settings },
];

export default function CommandPalette() {
  const t = useT();
  const navigate = useAppStore((s) => s.navigate);
  const setCommand = useAppStore((s) => s.setCommand);
  const playlists = usePlaylistStore((s) => s.playlists);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [libHits, setLibHits] = useState<LibraryHit[]>([]);
  const libReq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands: Cmd[] = useMemo(() => {
    const views: Cmd[] = VIEWS.map((v) => ({
      id: `view:${v.view}`,
      label: t(v.labelKey),
      hint: t("palette.view"),
      icon: v.icon,
      run: () => navigate(v.view),
    }));
    const pls: Cmd[] = playlists.map((p) => ({
      id: `pl:${p.id}`,
      label: p.name,
      hint: t("palette.playlist"),
      icon: ListMusic,
      run: () => navigate("playlist", p.id),
    }));
    return [...views, ...pls];
  }, [playlists, navigate, t]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(s) || c.hint.toLowerCase().includes(s)
    );
  }, [q, commands]);

  useEffect(() => {
    setSel(0);
  }, [q]);

  // ⭐ Kütüphane şarkıları (≥2 karakter): bellekte aranır, anında. Eski yanıt
  // yeni sorgunun üstüne yazmasın diye istek sayacı.
  useEffect(() => {
    const id = ++libReq.current;
    if (q.trim().length < 2) {
      setLibHits([]);
      return;
    }
    searchLibrary(q)
      .then((h) => {
        if (id === libReq.current) setLibHits(h);
      })
      .catch(() => {
        if (id === libReq.current) setLibHits([]);
      });
  }, [q]);

  const items: Cmd[] = useMemo(() => {
    const tracks: Cmd[] = libHits.map((h) => ({
      id: `lib:${h.track.id}`,
      label: `${h.track.title} — ${h.track.artist}`,
      hint: playlistsHint(h),
      icon: Music2,
      library: true,
      runNext: () => {
        usePlayerStore.getState().playNext(h.track);
        setCommand(false);
      },
      run: () => {
        usePlayerStore.getState().playNow(
          h.track,
          libHits.map((x) => x.track)
        );
        setCommand(false);
      },
    }));
    return [...filtered, ...tracks];
  }, [filtered, libHits, setCommand]);

  // Seçili öğeyi görünür tut.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[sel];
      if (e.shiftKey && it?.runNext) it.runNext();
      else it?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setCommand(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 pt-[12vh]"
      onClick={() => setCommand(false)}
    >
      <div
        className="w-full max-w-lg animate-pop-in overflow-hidden rounded-xl border border-border bg-surface-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search size={17} className="text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("palette.placeholder")}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-faint">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-faint">
              {t("palette.noResults")}
            </p>
          ) : (
            items.map((c, i) => {
              const Icon = c.icon;
              const firstLib = c.library && !items[i - 1]?.library;
              return (
                <Fragment key={c.id}>
                {firstLib && (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                    {t("palette.libraryGroup")}
                  </div>
                )}
                <button
                  data-idx={i}
                  onMouseMove={() => setSel(i)}
                  onClick={() => c.run()}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                    i === sel ? "bg-accent text-bg" : "text-text hover:bg-surface"
                  }`}
                >
                  <Icon
                    size={16}
                    className={i === sel ? "text-bg" : "text-muted"}
                  />
                  <span className="flex-1 truncate">{c.label}</span>
                  <span
                    className={`max-w-[40%] truncate text-[11px] ${
                      i === sel ? "text-bg/70" : "text-faint"
                    }`}
                  >
                    {c.hint}
                  </span>
                  {i === sel && <CornerDownLeft size={13} className="text-bg/70" />}
                </button>
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
