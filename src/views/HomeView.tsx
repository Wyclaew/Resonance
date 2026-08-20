import { useEffect, useState } from "react";
import {
  Sparkles,
  Clock,
  Radio,
  ListMusic,
  History,
  Play,
  Laptop,
  Compass,
} from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import TrackRow from "../components/TrackRow";
import type { Playlist, Track } from "../types";
import { getRecentTracks, weekDiscoveries } from "../lib/history";
import { buildTasteProfile, predictedStyles } from "../lib/taste";
import { isTauri } from "../lib/db";
import { getPlaylistTracks } from "../lib/playlists";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useAppStore } from "../store/useAppStore";
import { useT, dayNameOf } from "../lib/i18n";
import { useSettingsStore } from "../store/useSettingsStore";
import { otherDevicePlayback, type DevicePlayback } from "../lib/nowPlaying";
import { formatMs } from "../lib/format";

// "Şu An" — açılış ekranı. O anki bağlama göre son çalınanlar + çalma
// listelerine hızlı erişim + tek tıkla Resonance Radyosu (M4).
export default function HomeView() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 6
      ? t("home.goodNight")
      : hour < 12
      ? t("home.goodMorning")
      : hour < 18
      ? t("home.goodDay")
      : t("home.goodEvening");

  const playlists = usePlaylistStore((s) => s.playlists);
  const navigate = useAppStore((s) => s.navigate);
  const playNow = usePlayerStore((s) => s.playNow);
  const startSmartShuffle = usePlayerStore((s) => s.startSmartShuffle);
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);

  const [recent, setRecent] = useState<Track[]>([]);
  // Başka cihazda yarım kalan çalma (senkronlanan now_playing tablosundan).
  const [other, setOther] = useState<DevicePlayback | null>(null);
  const [loadingRadio, setLoadingRadio] = useState<string | null>(null);

  useEffect(() => {
    getRecentTracks(10).then(setRecent);
    // Başka cihazda yarım kalan çalma var mı? (senkronlanan now_playing)
    void otherDevicePlayback().then(setOther);
  }, []);

  async function radioFrom(p: Playlist) {
    setLoadingRadio(p.id);
    try {
      const tracks = await getPlaylistTracks(p.id);
      if (tracks.length) await startSmartShuffle(tracks, p.id);
    } finally {
      setLoadingRadio(null);
    }
  }

  const hasContent = recent.length > 0 || playlists.length > 0;

  // Saat profili tahmini (lib/taste.ts) — güven düşükse boş döner, o zaman
  // kart hiç gösterilmez (yanlış tahminle yer kaplamasın).
  const [predicted, setPredicted] = useState<string[]>([]);
  const [fresh, setFresh] = useState<Track[]>([]);
  const setLocked = usePlayerStore((s) => s.setLockedSeedArtist);
  const startDiscovery = usePlayerStore((s) => s.startDiscovery);

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      await buildTasteProfile();
      setPredicted(predictedStyles(3));
      setFresh(await weekDiscoveries());
    })();
  }, []);

  // "Bu tarzda keşfet": tohumu kilitleyip yeni parti kur (lockedSeedArtist
  // ağırlığı ×8 → parti gerçekten o tarzdan beslenir).
  const startInStyle = async (artist: string) => {
    setLocked(artist);
    navigate("discover");
    await startDiscovery({ force: true });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ViewHeader
        title={greeting}
        subtitle={t("home.subtitle")}
      />

      <div className="px-8 pb-10">
        {/* Bağlam şeridi */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 px-5 py-3.5">
          <Clock size={18} className="shrink-0 text-accent" />
          <p className="text-sm text-muted">
            {t("home.contextHint", {
              time: `${String(hour).padStart(2, "0")}:${String(
                now.getMinutes()
              ).padStart(2, "0")}`,
              day: dayNameOf(lang, now.getDay()),
            })}
          </p>
        </div>

        {/* ⭐ ŞU AN SANA GÖRE (v1.8.1): saat profilinin tahmini + tek tıkla
            o tarzda keşif. Ana sayfa bugüne kadar yalnız GEÇMİŞİ (son çalınan,
            listeler) gösteriyordu; modelin öğrendiği şey hiç görünmüyordu. */}
        {predicted.length > 0 && (
          <div className="mt-4 rounded-xl border border-accent/25 bg-accent/[0.07] p-4">
            <div className="flex items-center gap-2 text-xs text-accent">
              <Sparkles size={13} />
              {t("home.forNow")}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed">
              {t("home.forNowBody", { styles: predicted.join(" · ") })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {predicted.slice(0, 3).map((a) => (
                <button
                  key={a}
                  onClick={() => void startInStyle(a)}
                  className="rounded-full border border-accent/40 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent hover:text-bg"
                >
                  {t("home.startStyle", { artist: a })}
                </button>
              ))}
            </div>
          </div>
        )}


        {/* ⭐ Başka cihazda kaldığın yer (now_playing senkronu) */}
        {other && (
          <button
            onClick={() => {
              // Diğer cihazda bırakılan SANİYEDEN devam et.
              playNow(
                {
                  id: other.trackId,
                  source: "youtube",
                  sourceId: other.sourceId,
                  title: other.title,
                  artist: other.artist,
                  thumbnail: other.thumbnail,
                  durationMs: other.durationMs,
                },
                undefined,
                undefined,
                other.positionMs
              );
              setOther(null);
            }}
            className="group mt-4 flex w-full items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-accent"
          >
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-surface-2">
              {other.thumbnail && (
                <img src={other.thumbnail} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-accent">
                <Laptop size={12} />
                {t("home.otherDevice", { device: other.deviceName })}
              </div>
              <div className="truncate text-sm font-medium">{other.title}</div>
              <div className="truncate text-xs text-muted">
                {other.artist} · {formatMs(other.positionMs)} / {formatMs(other.durationMs)}
              </div>
            </div>
            <span className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg">
              {t("home.otherDeviceResume")}
            </span>
          </button>
        )}

        {/* ⭐ BU HAFTANIN KEŞİFLERİ: son 7 günde İLK KEZ dinlediğin sanatçılar.
            Keşfet'in gerçekten işe yarayıp yaramadığını görmenin en somut yolu
            — ve beğendiklerini listeye almanın hızlı yolu. */}
        {fresh.length > 0 && (
          <section className="mt-8">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <Compass size={13} /> {t("home.weekDiscoveries")}
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {fresh.map((tr) => (
                <button
                  key={tr.id}
                  onClick={() => playNow(tr, fresh)}
                  className="group flex items-center gap-2.5 rounded-lg border border-border bg-surface/60 p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface"
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-surface-2">
                    {tr.thumbnail && (
                      <img src={tr.thumbnail} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{tr.title}</div>
                    <div className="truncate text-[11px] text-muted">{tr.artist}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Son çalınanlar */}
        {recent.length > 0 && (
          <section className="mt-8">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <History size={13} /> {t("home.recent")}
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
              <ListMusic size={13} /> {t("home.yourPlaylists")}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {playlists.map((p) => (
                <div
                  key={p.id}
                  onClick={() => navigate("playlist", p.id)}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface/60 p-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface hover:shadow-lg hover:shadow-black/20"
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
                    <ListMusic size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">
                      {p.name}
                    </div>
                    <div className="text-xs text-muted">
                      {t("playlist.trackCount", { count: p.trackCount ?? 0 })}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (loadingRadio !== p.id) radioFrom(p);
                    }}
                    title={t("home.smartShuffleHint")}
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
            <Play size={14} /> {t("home.discoverSomething")}
          </button>
        )}

        {/* Boş durum (yeni kullanıcı) */}
        {!hasContent && (
          <div className="mt-10 flex flex-col items-center justify-center gap-3 py-16 text-faint">
            <Sparkles size={40} strokeWidth={1.5} />
            <p className="max-w-md text-center text-sm leading-relaxed">
              {t("home.emptyState")}
            </p>
            <button
              onClick={() => navigate("search")}
              className="mt-2 flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg"
            >
              <Play size={15} /> {t("home.startSearching")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
