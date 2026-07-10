import { useEffect, useState } from "react";
import { Sparkles, Clock, Radio, ListMusic, History, Play } from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import TrackRow from "../components/TrackRow";
import type { Playlist, Track } from "../types";
import { getRecentTracks } from "../lib/history";
import { getPlaylistTracks } from "../lib/playlists";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useAppStore } from "../store/useAppStore";

const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

// "Şu An" — açılış ekranı. O anki bağlama göre son çalınanlar + çalma
// listelerine hızlı erişim + tek tıkla Resonance Radyosu (M4).
export default function HomeView() {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 6
      ? "İyi geceler"
      : hour < 12
      ? "Günaydın"
      : hour < 18
      ? "İyi günler"
      : "İyi akşamlar";

  const playlists = usePlaylistStore((s) => s.playlists);
  const navigate = useAppStore((s) => s.navigate);
  const playNow = usePlayerStore((s) => s.playNow);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);

  const [recent, setRecent] = useState<Track[]>([]);
  const [loadingRadio, setLoadingRadio] = useState<string | null>(null);

  useEffect(() => {
    getRecentTracks(10).then(setRecent);
  }, []);

  async function radioFrom(p: Playlist) {
    setLoadingRadio(p.id);
    try {
      const tracks = await getPlaylistTracks(p.id);
      if (tracks.length) await startRadio(tracks, p.id);
    } finally {
      setLoadingRadio(null);
    }
  }

  const hasContent = recent.length > 0 || playlists.length > 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ViewHeader
        title={greeting}
        subtitle="Gün ve saate göre, kaldığın yerden devam et."
      />

      <div className="px-8 pb-10">
        {/* Bağlam şeridi */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-5 py-3.5">
          <Clock size={18} className="shrink-0 text-accent" />
          <p className="text-sm text-muted">
            Şu an{" "}
            <span className="tnum text-text">
              {String(hour).padStart(2, "0")}:
              {String(now.getMinutes()).padStart(2, "0")}
            </span>{" "}
            · {DAYS[now.getDay()]}. Oy verdikçe öneriler bu bağlama göre
            keskinleşir.
          </p>
        </div>

        {/* Son çalınanlar */}
        {recent.length > 0 && (
          <section className="mt-8">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <History size={13} /> Son çalınanlar
            </div>
            <div>
              {recent.map((t, i) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  index={i}
                  isCurrent={current?.id === t.id}
                  isPlaying={status === "playing"}
                  isLoading={status === "loading"}
                  onPlay={() => playNow(t, recent)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Çalma listeleri */}
        {playlists.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <ListMusic size={13} /> Çalma listelerin
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {playlists.map((p) => (
                <div
                  key={p.id}
                  onClick={() => navigate("playlist", p.id)}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface/60 p-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface hover:shadow-lg hover:shadow-black/20"
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
                    <ListMusic size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">
                      {p.name}
                    </div>
                    <div className="text-xs text-muted">
                      {p.trackCount} şarkı
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (loadingRadio !== p.id) radioFrom(p);
                    }}
                    title="Bu listeden radyo başlat"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted opacity-0 transition-all hover:bg-accent hover:text-bg group-hover:opacity-100"
                  >
                    <Radio
                      size={16}
                      className={loadingRadio === p.id ? "animate-pulse" : ""}
                    />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Hızlı aksiyon: arama */}
        {hasContent && (
          <button
            onClick={() => navigate("search")}
            className="mt-8 flex items-center gap-2 text-sm text-muted transition-colors hover:text-text"
          >
            <Play size={14} /> Yeni bir şey keşfet → Ara
          </button>
        )}

        {/* Boş durum (yeni kullanıcı) */}
        {!hasContent && (
          <div className="mt-10 flex flex-col items-center justify-center gap-3 py-16 text-faint">
            <Sparkles size={40} strokeWidth={1.5} />
            <p className="max-w-md text-center text-sm leading-relaxed">
              Henüz veri yok. Bir şarkı arayıp çalmaya, çalma listeleri
              oluşturup oy vermeye başla — algoritma hangi gün ve saatte neyi
              sevdiğini öğrenip burayı sana göre dolduracak.
            </p>
            <button
              onClick={() => navigate("search")}
              className="mt-2 flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg"
            >
              <Play size={15} /> Aramaya başla
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
