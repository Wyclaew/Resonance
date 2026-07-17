import { useState, useRef, useEffect } from "react";
import { Search, Youtube, Loader2, AlertCircle, Clock, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import ViewHeader from "../components/ViewHeader";
import TrackRow from "../components/TrackRow";
import type { Track } from "../types";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { isTauri } from "../lib/db";
import { useT } from "../lib/i18n";

const DEBOUNCE_MS = 150;
const MIN_CHARS = 2;
const HISTORY_KEY = "resonance.searchHistory";
const HISTORY_MAX = 8;

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveHistory(h: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_MAX)));
}

export default function SearchView() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [focused, setFocused] = useState(false);
  const reqId = useRef(0);

  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const playNow = usePlayerStore((s) => s.playNow);

  function remember(q: string) {
    setHistory((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  }
  function removeHistory(q: string, e: React.MouseEvent) {
    e.stopPropagation();
    setHistory((prev) => {
      const next = prev.filter((x) => x !== q);
      saveHistory(next);
      return next;
    });
  }

  async function runSearch(q: string, addToHistory = false) {
    if (!isTauri()) {
      setError(t("search.tauriOnly"));
      setSearched(true);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<Track[]>("search_youtube", {
        query: q,
        limit: 20,
        cookiesBrowser: useSettingsStore.getState().cookiesBrowser,
      });
      if (id === reqId.current) {
        setResults(res);
        setSearched(true);
        if (addToHistory) remember(q);
      }
    } catch (e) {
      if (id === reqId.current) setError(String(e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  // Yazdıkça otomatik ara (debounce). Sonuçlar gelene kadar eski liste durur.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      reqId.current++;
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    const handle = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Bir şarkı çalınınca aramayı geçmişe ekle (anlamlı sorgu işareti).
  const showHistory = focused && query.trim().length === 0 && history.length > 0;

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title={t("search.title")}
        subtitle={t("search.hint")}
      />

      <div className="px-8">
        <div className="relative">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 focus-within:border-border-strong">
            <Search
              size={18}
              className={loading ? "text-accent" : "text-faint"}
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim().length >= MIN_CHARS) {
                  runSearch(query.trim(), true);
                  setFocused(false);
                }
              }}
              placeholder={t("search.placeholder")}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            {loading && (
              <Loader2 size={16} className="animate-spin text-accent" />
            )}
          </div>

          {/* Arama geçmişi */}
          {showHistory && (
            <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-border bg-surface-2 py-1 shadow-2xl">
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
                {t("search.recent")}
              </div>
              {history.map((h) => (
                <button
                  key={h}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setQuery(h);
                    runSearch(h, true);
                  }}
                  className="group flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-muted hover:bg-surface-3 hover:text-text"
                >
                  <Clock size={14} className="shrink-0 text-faint" />
                  <span className="flex-1 truncate">{h}</span>
                  <span
                    role="button"
                    onMouseDown={(e) => removeHistory(h, e)}
                    className="text-faint opacity-0 hover:text-text group-hover:opacity-100"
                  >
                    <X size={14} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className={`mt-4 min-h-0 flex-1 overflow-y-auto px-6 pb-6 transition-opacity ${
          loading && results.length > 0 ? "opacity-60" : "opacity-100"
        }`}
      >
        {error && (
          <div className="mx-2 flex items-center gap-2 rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        {!error && !searched && results.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-faint">
            <Youtube size={40} strokeWidth={1.5} />
            <p className="max-w-sm text-center text-sm leading-relaxed">
              Yazmaya başla — sonuçlar YouTube'dan anında gelir. Çalmak için çift
              tıkla; indirmek istersen indir ikonuna bas.
            </p>
          </div>
        )}

        {/* İlk arama yükleniyor — iskelet (skeleton) */}
        {loading && results.length === 0 && (
          <div className="space-y-1 px-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="skeleton h-10 w-10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div
                    className="skeleton h-3"
                    style={{ width: `${45 - (i % 4) * 8}%` }}
                  />
                  <div className="skeleton h-2.5 w-1/5" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!error && searched && results.length === 0 && !loading && (
          <p className="py-24 text-center text-sm text-faint">{t("search.noResults")}</p>
        )}

        {results.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            index={i}
            isCurrent={current?.id === t.id}
            isPlaying={status === "playing"}
            isLoading={status === "loading"}
            onPlay={() => {
              playNow(t, results);
              if (query.trim()) remember(query.trim());
            }}
          />
        ))}
      </div>
    </div>
  );
}
