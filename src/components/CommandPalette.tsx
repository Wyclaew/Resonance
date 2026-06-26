import { useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  Sparkles,
  Library,
  Download,
  Import,
  Settings,
  ListMusic,
  CornerDownLeft,
} from "lucide-react";
import type { ViewId } from "../types";
import { useAppStore } from "../store/useAppStore";
import { usePlaylistStore } from "../store/usePlaylistStore";

// Komut paleti (Cmd/Ctrl+K) — görünümler ve çalma listeleri arasında klavyeyle
// hızlı gezinme. Yaz → filtrele, ok tuşları → seç, Enter → git, Esc → kapat.
interface Cmd {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  run: () => void;
}

const VIEWS: { view: ViewId; label: string; icon: typeof Search }[] = [
  { view: "now", label: "Şu An", icon: Sparkles },
  { view: "search", label: "Ara", icon: Search },
  { view: "library", label: "Kütüphane", icon: Library },
  { view: "downloads", label: "İndirilenler", icon: Download },
  { view: "import", label: "İçe Aktar", icon: Import },
  { view: "settings", label: "Ayarlar", icon: Settings },
];

export default function CommandPalette() {
  const navigate = useAppStore((s) => s.navigate);
  const setCommand = useAppStore((s) => s.setCommand);
  const playlists = usePlaylistStore((s) => s.playlists);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands: Cmd[] = useMemo(() => {
    const views: Cmd[] = VIEWS.map((v) => ({
      id: `view:${v.view}`,
      label: v.label,
      hint: "Görünüm",
      icon: v.icon,
      run: () => navigate(v.view),
    }));
    const pls: Cmd[] = playlists.map((p) => ({
      id: `pl:${p.id}`,
      label: p.name,
      hint: "Çalma listesi",
      icon: ListMusic,
      run: () => navigate("playlist", p.id),
    }));
    return [...views, ...pls];
  }, [playlists, navigate]);

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

  // Seçili öğeyi görünür tut.
  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(filtered.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[sel]?.run();
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
            placeholder="Git… (görünüm veya çalma listesi ara)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-faint">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-faint">
              Eşleşme yok.
            </p>
          ) : (
            filtered.map((c, i) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
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
                    className={`text-[11px] ${
                      i === sel ? "text-bg/70" : "text-faint"
                    }`}
                  >
                    {c.hint}
                  </span>
                  {i === sel && <CornerDownLeft size={13} className="text-bg/70" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
