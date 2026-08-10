import { useState } from "react";
import {
  Sparkles,
  RefreshCw,
  Shuffle,
  X,
  Play,
  Pause,
  FlaskConical,
} from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import { useT } from "../lib/i18n";
import { usePlayerStore } from "../store/usePlayerStore";
import { reasonText } from "../lib/recommender";
import { useSettingsStore } from "../store/useSettingsStore";
import { DISCOVERY_FILTERS, randomFilters } from "../lib/filters";
import { formatMs } from "../lib/format";
import { topStyles } from "../lib/mood";

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

  // Seçim yerelde tutulur; "Yeni keşif"e basılınca uygulanır. Böylece her
  // tıklamada yeni bir parti kurulmaz (her parti ~6 radyo çağrısı demek).
  const [draft, setDraft] = useState<string[]>(activeFilters);
  const dirty =
    draft.length !== activeFilters.length ||
    draft.some((f) => !activeFilters.includes(f));

  const upcoming = queue.slice(queueIndex + 1);
  const isPlaying = status === "playing";
  // Oturum modu: bu açılışta hangi tarzları sonuna kadar dinledin. Modül
  // durumu olduğu için reaktif değil — kuyruk/parça değiştikçe zaten
  // yeniden render olduğundan pratikte güncel kalır.
  const mood = topStyles(3);

  const toggleFilter = (id: string) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  const apply = async (ids: string[]) => {
    setDraft(ids);
    setFilters(ids);
    await startDiscovery({ force: true });
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
        <button
          onClick={() => void apply(randomFilters())}
          disabled={discovering}
          title={t("discover.random")}
          className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted transition-colors hover:text-text disabled:opacity-40"
        >
          <Shuffle size={14} />
          {t("discover.random")}
        </button>
        <button
          onClick={() => void apply(draft)}
          disabled={discovering}
          className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity disabled:opacity-40"
        >
          <RefreshCw size={14} className={discovering ? "animate-spin" : ""} />
          {discovering ? t("discover.preparing") : t("discover.apply")}
        </button>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
        {/* Filtreler */}
        <section className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{t("discover.filters")}</span>
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

          <div className="mt-3">
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
            {dirty && " ●"}
          </p>
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
