import { useEffect, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  Shuffle,
  X,
  Play,
  Pause,
  FlaskConical,
  ChevronDown,
  SlidersHorizontal,
  Ban,
  Lock,
  Unlock,
  ListPlus,
} from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import DeviceQueuePicker from "../components/DeviceQueuePicker";
import { useT } from "../lib/i18n";
import { usePlayerStore } from "../store/usePlayerStore";
import { reasonText } from "../lib/recommender";
import { useSettingsStore } from "../store/useSettingsStore";
import { DISCOVERY_FILTERS } from "../lib/filters";
import { formatMs } from "../lib/format";
import { topStyles } from "../lib/mood";
import { labelsForArtists, loadTags } from "../lib/tags";
import { blockArtist } from "../lib/blocked";
import { savePlaylistFromTracks } from "../lib/playlists";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useToastStore } from "../store/useToastStore";

// Keşfet — kendi SAYFASI (eskiden sıra panelinin içindeydi, sağ üstte çarpı
// vardı). Sayfa olunca: filtreler, mod bilgisi ve tüm kuyruk aynı yerde durur,
// gezinince kapanmaz.

export default function DiscoverView() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);

  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const discovering = usePlayerStore((s) => s.discovering);
  const activeFilters = usePlayerStore((s) => s.discoveryFilters);
  const setFilters = usePlayerStore((s) => s.setDiscoveryFilters);
  const startDiscovery = usePlayerStore((s) => s.startDiscovery);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const toggle = usePlayerStore((s) => s.toggle);
  const locked = usePlayerStore((s) => s.lockedSeedArtist);
  const setLocked = usePlayerStore((s) => s.setLockedSeedArtist);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const toast = useToastStore((s) => s.show);

  // "Bu sanatçıyı önerme": engelle + kuyruktaki diğer parçalarını da temizle
  // (yoksa engelledikten sonra sırada duran şarkıları yine çalardı).
  const block = async (artist: string) => {
    await blockArtist(artist);
    const st = usePlayerStore.getState();
    for (const it of st.queue.slice(st.queueIndex + 1)) {
      if (it.artist.toLowerCase() === artist.toLowerCase()) {
        removeFromQueue(it.uid);
      }
    }
    toast(t("discover.blocked", { artist }), "info");
  };

  // Seçim yerelde tutulur; "Yeni keşif"e basılınca uygulanır. Böylece her
  // tıklamada yeni bir parti kurulmaz (her parti ~6 radyo çağrısı demek).
  const [draft, setDraft] = useState<string[]>(activeFilters);
  // Filtre paneli varsayılan KAPALI (kuyruk varken) — sürekli göz önünde
  // durması sayfayı boğuyordu. Kuyruk boşken açık gelir ki ilk kullanımda
  // kullanıcı filtreleri görsün.
  const [filtersOpen, setFiltersOpen] = useState(!usePlayerStore.getState().current);
  const [saving, setSaving] = useState(false);
  const refreshPlaylists = usePlaylistStore((s) => s.refresh);
  useEffect(() => {
    void loadTags();
  }, []);
  const dirty =
    draft.length !== activeFilters.length ||
    draft.some((f) => !activeFilters.includes(f));

  const upcoming = queue.slice(queueIndex + 1);
  const isPlaying = status === "playing";
  // Oturum modu: bu açılışta hangi tarzları sonuna kadar dinledin. Modül
  // durumu olduğu için reaktif değil — kuyruk/parça değiştikçe zaten
  // yeniden render olduğundan pratikte güncel kalır.
  const moodArtists = topStyles(3);
  // ⭐ Sanatçı adı yerine ANLAŞILIR etiket ("sakin · rock"). Etiketler filtre
  // havuzlarından birikir (lib/tags.ts); henüz birikmediyse sanatçı adına
  // düşülür — yanlış bilgi vermektense ham veriyi göstermek daha dürüst.
  const moodLabels = labelsForArtists(moodArtists);
  const mood = moodLabels.length > 0 ? moodLabels : moodArtists;

  const toggleFilter = (id: string) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  const apply = async (ids: string[]) => {
    setDraft(ids);
    setFilters(ids);
    await startDiscovery({ force: true });
  };

  // "Bu seti kaydet": kuyruk geçici, liste kalıcı. Ad, aktif filtrelerden
  // (yoksa tarihten) üretilir — kullanıcı sonradan yeniden adlandırabilir.
  const saveQueue = async () => {
    if (queue.length === 0 || saving) return;
    setSaving(true);
    try {
      const label = activeFilters
        .map((id) => DISCOVERY_FILTERS.find((f) => f.id === id))
        .filter(Boolean)
        .map((f) => t(f!.labelKey))
        .join(" · ");
      const name = `${t("discover.savedName")} — ${
        label || new Date().toLocaleDateString()
      }`;
      const { added } = await savePlaylistFromTracks(name, queue);
      await refreshPlaylists();
      toast(t("discover.saveQueueDone", { count: added, name }), "success");
    } catch (e) {
      console.error("[resonance] kuyruk kaydedilemedi:", e);
      toast(t("discover.saveQueueFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const moods = DISCOVERY_FILTERS.filter((f) => f.kind === "mood");
  const genres = DISCOVERY_FILTERS.filter((f) => f.kind === "genre");

  const Chip = ({ id, label }: { id: string; label: string }) => {
    const on = draft.includes(id);
    return (
      <button
        onClick={() => toggleFilter(id)}
        className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
          on
            ? "border-accent bg-accent/15 text-accent"
            : "border-border text-muted hover:border-muted hover:text-text"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t("discover.title")} subtitle={t("discover.subtitle")}>
        {/* Başka cihazdaki keşfeti getir (yalnız o cihaz varsa görünür). */}
        <DeviceQueuePicker />
        <button
          onClick={() => void saveQueue()}
          disabled={saving || queue.length === 0}
          title={t("discover.saveQueue")}
          className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          <ListPlus size={14} />
          {t("discover.saveQueue")}
        </button>
        {/* ⭐ İKİ DÜĞME BİRBİRİNİ DIŞLAR (v1.8.0): "Rastgele" tanımı gereği
            FİLTRESİZ gezinmedir, "Yeni keşif" ise seçilen filtreleri uygular.
            Eskiden ikisi de her durumda basılabiliyordu ve kullanıcı filtre
            seçip "Rastgele"ye basınca seçimi sessizce çöpe gidiyordu. */}
        <button
          onClick={() => void apply([])}
          disabled={discovering || draft.length > 0}
          title={
            draft.length > 0 ? t("discover.randomBlocked") : t("discover.random")
          }
          className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          <Shuffle size={14} />
          {t("discover.random")}
        </button>
        <button
          onClick={() => {
            // Filtresiz basılırsa sessizce filtresiz parti kurmak yerine ne
            // yapması gerektiğini SÖYLE (düğme zaten soluk duruyor).
            if (draft.length === 0) {
              setFiltersOpen(true);
              toast(t("discover.pickFilterFirst"), "info");
              return;
            }
            void apply(draft);
          }}
          disabled={discovering}
          title={
            draft.length === 0 ? t("discover.pickFilterFirst") : t("discover.apply")
          }
          className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40 ${
            draft.length === 0
              ? "bg-surface-2 text-faint"
              : "bg-accent text-bg"
          }`}
        >
          <RefreshCw size={14} className={discovering ? "animate-spin" : ""} />
          {discovering ? t("discover.preparing") : t("discover.apply")}
        </button>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
        {/* Filtreler — açılır/kapanır */}
        <section
          data-tour="filters"
          className="rounded-lg border border-border bg-surface"
        >
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <SlidersHorizontal size={15} className="text-accent" />
              {t("discover.filters")}
              <span className="text-xs font-normal text-faint">
                ·{" "}
                {draft.length === 0
                  ? t("discover.filtersNone")
                  : t("discover.filtersActive", { count: draft.length })}
                {dirty && " ●"}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {!filtersOpen && draft.length > 0 && (
                <span className="hidden max-w-[22rem] truncate text-xs text-muted sm:inline">
                  {draft
                    .map((id) => DISCOVERY_FILTERS.find((f) => f.id === id))
                    .filter(Boolean)
                    .map((f) => t(f!.labelKey))
                    .join(" · ")}
                </span>
              )}
              <ChevronDown
                size={16}
                className={`shrink-0 text-muted transition-transform ${
                  filtersOpen ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>

          {filtersOpen && (
            <div className="border-t border-border px-4 pb-4 pt-3">
              <div className="flex items-center justify-end">
                {draft.length > 0 && (
                  <button
                    onClick={() => setDraft([])}
                    className="flex items-center gap-1 text-xs text-muted hover:text-text"
                  >
                    <X size={12} />
                    {t("discover.clear")}
                  </button>
                )}
              </div>

              <div className="mt-1">
                <div className="mb-1.5 text-xs uppercase tracking-wide text-faint">
                  {t("discover.moodGroup")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {moods.map((f) => (
                    <Chip key={f.id} id={f.id} label={t(f.labelKey)} />
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1.5 text-xs uppercase tracking-wide text-faint">
                  {t("discover.genreGroup")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {genres.map((f) => (
                    <Chip key={f.id} id={f.id} label={t(f.labelKey)} />
                  ))}
                </div>
              </div>

              <p className="mt-3 text-xs text-faint">
                {draft.length === 0
                  ? t("discover.noFilterHint")
                  : t("discover.filterHint", { count: draft.length })}
              </p>
            </div>
          )}
        </section>

        {/* Şimdi çalıyor */}
        {current ? (
          <>
            <div className="mt-6 flex items-center gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-surface-2">
                {current.thumbnail && (
                  <img
                    src={current.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wide text-accent">
                  {t("discover.nowPlaying")}
                </div>
                <div className="truncate text-base font-medium">
                  {current.title}
                </div>
                <div className="truncate text-sm text-muted">
                  {current.artist}
                </div>
                {current.recReason && (
                  <div className="mt-0.5 truncate text-xs text-faint">
                    {reasonText(current.recReason, lang)}
                  </div>
                )}
              </div>
              {current.seedArtist && (
                <button
                  onClick={() =>
                    setLocked(
                      locked === current.seedArtist!.toLowerCase()
                        ? null
                        : current.seedArtist!
                    )
                  }
                  title={t("discover.lockHint")}
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors ${
                    locked === current.seedArtist.toLowerCase()
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-muted hover:text-text"
                  }`}
                >
                  {locked === current.seedArtist.toLowerCase() ? (
                    <Lock size={15} />
                  ) : (
                    <Unlock size={15} />
                  )}
                </button>
              )}
              <button
                onClick={() => void block(current.artist)}
                title={t("discover.blockHint")}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted transition-colors hover:border-down hover:text-down"
              >
                <Ban size={15} />
              </button>
              <button
                onClick={toggle}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-text text-bg transition-transform hover:scale-105"
                title={isPlaying ? t("player.pause") : t("player.play")}
              >
                {isPlaying ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" className="ml-0.5" />
                )}
              </button>
            </div>

            {locked && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-accent">
                <Lock size={11} />
                {t("discover.lockedOn", { artist: locked })}
                <button
                  onClick={() => setLocked(null)}
                  className="underline underline-offset-2 hover:text-text"
                >
                  {t("discover.unlock")}
                </button>
              </p>
            )}
            {mood.length > 0 && (
              <p className="mt-3 text-xs text-faint">
                {t("discover.moodNow", { styles: mood.join(", ") })}
              </p>
            )}

            {/* Sıradakiler */}
            <div className="mt-6 text-xs uppercase tracking-wide text-faint">
              {t("discover.upNext")} · {upcoming.length}
            </div>
            <div className="mt-2">
              {upcoming.map((item, i) => (
                <button
                  key={item.uid}
                  onClick={() => jumpTo(queueIndex + 1 + i)}
                  className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface"
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-surface-2">
                    {item.thumbnail && (
                      <img
                        src={item.thumbnail}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {item.isProbe && (
                        <span
                          title={t("discover.probeHint")}
                          className="flex shrink-0 items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent"
                        >
                          <FlaskConical size={9} />
                          {t("discover.probe")}
                        </span>
                      )}
                      <span className="truncate text-sm">{item.title}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {item.artist}
                      {item.recReason
                        ? ` · ${reasonText(item.recReason, lang)}`
                        : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-faint">
                    {formatMs(item.durationMs)}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-faint">
            <Sparkles size={40} strokeWidth={1.5} />
            <p className="text-sm">{t("discover.empty")}</p>
            <button
              onClick={() => void apply(draft)}
              disabled={discovering}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-40"
            >
              {discovering ? t("discover.preparing") : t("discover.start")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
