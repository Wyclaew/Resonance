import { useState, useRef, useEffect } from "react";
import { Search, Youtube, Loader2, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import ViewHeader from "../components/ViewHeader";
import TrackRow from "../components/TrackRow";
import type { Track } from "../types";
import { usePlayerStore } from "../store/usePlayerStore";
import { isTauri } from "../lib/db";

const DEBOUNCE_MS = 400;
const MIN_CHARS = 2;

export default function SearchView() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const reqId = useRef(0);

  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const playNow = usePlayerStore((s) => s.playNow);

  async function runSearch(q: string) {
    if (!isTauri()) {
      setError("Arama yalnızca uygulama içinde çalışır (web önizlemesi değil).");
      setSearched(true);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<Track[]>("search_youtube", { query: q, limit: 20 });
      if (id === reqId.current) {
        setResults(res);
        setSearched(true);
      }
    } catch (e) {
      if (id === reqId.current) setError(String(e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  // Yazdıkça otomatik ara (debounce). Enter beklemeye gerek yok.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      reqId.current++; // bekleyen sonuçları geçersiz kıl
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    const handle = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title="Ara"
        subtitle="YouTube üzerinde şarkı, sanatçı veya albüm ara — yazdıkça gelir."
      />

      <div className="px-8">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 focus-within:border-border-strong">
          {loading ? (
            <Loader2 size={18} className="animate-spin text-accent" />
          ) : (
            <Search size={18} className="text-faint" />
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim().length >= MIN_CHARS)
                runSearch(query.trim());
            }}
            placeholder="Ne dinlemek istersin?"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {error && (
          <div className="mx-2 flex items-center gap-2 rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        {!error && !searched && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-faint">
            <Youtube size={40} strokeWidth={1.5} />
            <p className="max-w-sm text-center text-sm leading-relaxed">
              Yazmaya başla — sonuçlar YouTube'dan anında gelir. Çalmak için
              çift tıkla; indirmek istersen indir ikonuna bas.
            </p>
          </div>
        )}

        {!error && searched && results.length === 0 && !loading && (
          <p className="py-24 text-center text-sm text-faint">Sonuç bulunamadı.</p>
        )}

        {results.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            index={i}
            isCurrent={current?.id === t.id}
            isPlaying={status === "playing"}
            isLoading={status === "loading"}
            onPlay={() => playNow(t, results)}
          />
        ))}
      </div>
    </div>
  );
}
