import { useState } from "react";
import { Download, Link2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ViewHeader from "../components/ViewHeader";
import type { Track } from "../types";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useAppStore } from "../store/useAppStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { importTracks } from "../lib/playlists";
import { isShareCode, decodePlaylist } from "../lib/share";
import { isTauri } from "../lib/db";
import { useT, type TrKey } from "../lib/i18n";

type Status = "idle" | "loading" | "importing" | "done";
type Src = "spotify" | "ytmusic" | "youtube" | "code" | null;

function detectSource(text: string): Src {
  const u = text.trim();
  if (!u) return null;
  if (isShareCode(u)) return "code";
  const l = u.toLowerCase();
  if (l.includes("open.spotify.com/playlist")) return "spotify";
  if (l.includes("music.youtube.com") && l.includes("list=")) return "ytmusic";
  if (l.includes("youtube.com/playlist") && l.includes("list=")) return "youtube";
  if (l.includes("youtube.com") && l.includes("list=")) return "youtube";
  return null;
}

// Çeviri ANAHTARI (metin değil) — dil değişince kaynak adı da değişsin.
const SRC_LABEL: Record<Exclude<Src, null>, TrKey> = {
  spotify: "import.srcSpotify",
  ytmusic: "import.srcYtMusic",
  youtube: "import.srcYouTube",
  code: "import.srcCode",
};

export default function ImportView() {
  const t = useT();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"matching" | "adding">("adding");
  const [result, setResult] = useState<{
    name: string;
    count: number;
    id: string;
    total: number;
  } | null>(null);

  const create = usePlaylistStore((s) => s.create);
  const refreshPlaylists = usePlaylistStore((s) => s.refresh);
  const navigate = useAppStore((s) => s.navigate);
  const cookiesBrowser = useSettingsStore((s) => s.cookiesBrowser);
  const spotifyClientId = useSettingsStore((s) => s.spotifyClientId);
  const spotifyClientSecret = useSettingsStore((s) => s.spotifyClientSecret);

  const detected = detectSource(url);
  const busy = status === "loading" || status === "importing";

  async function runImport(name: string, tracks: Track[], total?: number) {
    setPhase("adding");
    setStatus("importing");
    setProgress({ done: 0, total: tracks.length });
    const p = await create(name);
    if (!p) {
      setError(t("import.createFailed"));
      setStatus("idle");
      return;
    }
    await importTracks(p.id, tracks, (done, t) => setProgress({ done, total: t }));
    await refreshPlaylists();
    setResult({ name, count: tracks.length, id: p.id, total: total ?? tracks.length });
    setStatus("done");
  }

  async function doImport() {
    setError(null);
    setResult(null);
    const text = url.trim();
    if (!isTauri()) {
      setError(t("import.tauriOnly"));
      return;
    }
    if (detected === "code") {
      const decoded = decodePlaylist(text);
      if (!decoded) return setError(t("import.codeFailed"));
      await runImport(decoded.name, decoded.tracks);
      return;
    }
    if (detected === "spotify") {
      // Anahtar GEREKMİYOR: anahtarsız (embed) yol ≤100 şarkıyı doğrudan okur.
      // Anahtar girilmişse backend tam listeyi (100+) API'den çeker.
      setStatus("loading");
      setPhase("matching");
      const unlisten = await listen<{ done: number; total: number }>(
        "spotify-progress",
        (e) => {
          setStatus("importing");
          setPhase("matching");
          setProgress({ done: e.payload.done, total: e.payload.total });
        }
      );
      try {
        const res = await invoke<{ name: string; tracks: Track[]; total: number }>(
          "import_spotify",
          {
            url: text,
            clientId: spotifyClientId,
            clientSecret: spotifyClientSecret,
            cookiesBrowser,
          }
        );
        unlisten();
        await runImport(res.name, res.tracks, res.total);
      } catch (e) {
        unlisten();
        setError(String(e));
        setStatus("idle");
      }
      return;
    }
    if (detected === "youtube" || detected === "ytmusic") {
      setStatus("loading");
      try {
        const meta = await invoke<{ title: string; tracks: Track[]; total: number }>(
          "import_playlist",
          { url: text, cookiesBrowser }
        );
        await runImport(meta.title, meta.tracks, meta.total);
      } catch (e) {
        setError(String(e));
        setStatus("idle");
      }
      return;
    }
    setError(t("import.invalidLong"));
  }

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ViewHeader
        title={t("import.title")}
        subtitle={t("import.subtitle")}
      />

      <div className="mx-auto w-full max-w-2xl px-8">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 focus-within:border-border-strong">
          <Link2 size={18} className="text-faint" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && detected && !busy && doImport()}
            placeholder="https://music.youtube.com/playlist?list=…  ·  RSNC1:…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <button
            onClick={doImport}
            disabled={!detected || busy}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:cursor-not-allowed disabled:opacity-30"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            {t("import.button")}
          </button>
        </div>

        {url && detected && status === "idle" && (
          <p className="mt-2 px-1 text-xs text-muted">
            {t("import.detected", { source: t(SRC_LABEL[detected]) })}
          </p>
        )}
        {url && !detected && status === "idle" && (
          <p className="mt-2 px-1 text-xs text-faint">
            {t("import.invalid")}
          </p>
        )}

        {/* İlerleme */}
        {status === "loading" && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin text-accent" />
            {t("import.reading")}
          </div>
        )}
        {status === "importing" && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
              <span>
                {phase === "matching"
                  ? t("import.matching")
                  : t("import.adding")}
              </span>
              <span className="tnum">
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
        {status === "done" && result && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-up/30 bg-up/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-up">
              <CheckCircle2 size={16} />
              <span>
                {t("import.done", { count: result.count, name: result.name })}
              </span>
            </div>
            <button
              onClick={() => navigate("playlist", result.id)}
              className="shrink-0 rounded-md bg-surface-2 px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-3"
            >
              {t("import.openList")}
            </button>
          </div>
        )}
        {status === "done" && result && result.total > result.count && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>
              {t("import.partial", { total: result.total, count: result.count })}
            </span>
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-down/30 bg-down/10 px-4 py-3 text-sm text-down">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 rounded-lg border border-border bg-surface/50 p-5 text-sm leading-relaxed text-muted">
          <p className="mb-2 font-medium text-text">{t("import.howTitle")}</p>
          <p>{t("import.howYt")}</p>
          <p className="mt-2">
            <b className="text-text">{t("import.howSpotifyBold")}</b>
            {t("import.howSpotify")}
          </p>
          <p className="mt-2 text-faint">{t("import.howSpotifyNote")}</p>
        </div>
      </div>
    </div>
  );
}
