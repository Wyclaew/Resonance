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

const SRC_LABEL: Record<Exclude<Src, null>, string> = {
  spotify: "Spotify çalma listesi",
  ytmusic: "YouTube Music çalma listesi",
  youtube: "YouTube çalma listesi",
  code: "Resonance paylaşım kodu",
};

export default function ImportView() {
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
      setError("Liste oluşturulamadı.");
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
      setError("İçe aktarma yalnızca uygulama içinde çalışır.");
      return;
    }
    if (detected === "code") {
      const decoded = decodePlaylist(text);
      if (!decoded) return setError("Paylaşım kodu çözülemedi (bozuk olabilir).");
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
    setError("Geçerli bir çalma listesi bağlantısı veya Resonance kodu değil.");
  }

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ViewHeader
        title="İçe Aktar"
        subtitle="Spotify / YouTube Music çalma listesi linkini ya da Resonance paylaşım kodunu yapıştır."
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
            İçe Aktar
          </button>
        </div>

        {url && detected && status === "idle" && (
          <p className="mt-2 px-1 text-xs text-muted">Algılandı: {SRC_LABEL[detected]}</p>
        )}
        {url && !detected && status === "idle" && (
          <p className="mt-2 px-1 text-xs text-faint">
            Geçerli bir Spotify/YouTube Music linki veya Resonance kodu değil.
          </p>
        )}

        {/* İlerleme */}
        {status === "loading" && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin text-accent" />
            Çalma listesi okunuyor…
          </div>
        )}
        {status === "importing" && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
              <span>
                {phase === "matching"
                  ? "YouTube'da eşleştiriliyor…"
                  : "Şarkılar ekleniyor…"}
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
                {result.count} şarkı "{result.name}" listesine eklendi.
              </span>
            </div>
            <button
              onClick={() => navigate("playlist", result.id)}
              className="shrink-0 rounded-md bg-surface-2 px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-3"
            >
              Listeyi aç
            </button>
          </div>
        )}
        {status === "done" && result && result.total > result.count && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>
              Bu listede {result.total} şarkı var ama {result.count} tanesi
              alınabildi. YouTube giriş yapılmadan en fazla ~100 şarkı veriyor
              (ya da liste özel). Tümünü almak için Ayarlar → Entegrasyonlar'dan
              YouTube tarayıcını seç, sonra tekrar dene.
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
          <p className="mb-2 font-medium text-text">Nasıl çalışır?</p>
          <p>
            YouTube / YouTube Music çalma listeleri anahtarsız, doğrudan içe
            aktarılır. Paylaşım kodu (RSNC1:…) ile bir arkadaşının listesini
            uygulamana kopyalayabilirsin. Ses YouTube'dan çalar.
          </p>
          <p className="mt-2">
            <b className="text-text">Spotify de anahtarsız</b> — herkese açık bir
            listenin linkini yapıştırman yeterli. Spotify'ın sesi alınamadığı için
            şarkılar YouTube'da eşleştirilip oradan çalar.
          </p>
          <p className="mt-2 text-faint">
            Not: Anahtarsız yol bir listeden en fazla <b className="text-text">100
            şarkı</b> okur. Daha uzun listelerin tamamı için Ayarlar →
            Entegrasyonlar'dan tek seferlik ücretsiz Spotify anahtarı girebilirsin
            (opsiyonel).
          </p>
        </div>
      </div>
    </div>
  );
}
