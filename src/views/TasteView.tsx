import { useCallback, useEffect, useState } from "react";
import {
  Brain,
  Minus,
  Plus,
  Ban,
  RotateCcw,
  Target,
  Compass,
  Network,
} from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import { useT } from "../lib/i18n";
import { isTauri } from "../lib/db";
import { buildSignals } from "../lib/recommender";
import { useSettingsStore } from "../store/useSettingsStore";
import {
  acceptanceRate,
  acceptanceShown,
  acceptanceReport,
  buildAcceptance,
  type AcceptanceReport,
} from "../lib/acceptance";
import {
  allBuckets,
  bucketOf,
  buildTasteProfile,
  currentBucketPlays,
  currentConfidence,
  splitBucket,
} from "../lib/taste";
import {
  PREF_LESS,
  PREF_MORE,
  PREF_NORMAL,
  loadArtistPrefs,
  prefWeight,
  setArtistPref,
} from "../lib/prefs";
import {
  blockArtist,
  blockedArtists,
  loadBlockedArtists,
  unblockArtist,
} from "../lib/blocked";
import { graphSize } from "../lib/graph";

// ═══════════════════════════════════════════════════════════════════════════
// "RESONANCE SENİ NASIL TANIYOR" — modelin içi + elle düzeltme.
//
// NEDEN VAR: dört öğrenme katmanı da DOLAYLIYDI ve KAPALI KUTUYDU. Kullanıcı
// ne öğrenildiğini göremiyor, yalnız oy vererek dolaylı düzeltebiliyordu.
// Burası iki şeyi birden çözer:
//   1) ŞEFFAFLIK — yakınlık, saat profili, güven, öneri kabul oranı görünür.
//   2) KONTROL — sanatçı başına "daha çok / daha az / engelle".
//
// ⚠️ Yakınlık listesi, ÖNERİYİ ÜRETEN hesabın ta kendisidir
// (`buildSignals`, recommender.ts). Ayrı bir hesap yazılsaydı ekranda
// gösterilen model ile çalışan model zamanla birbirinden sapardı.
// ═══════════════════════════════════════════════════════════════════════════

type Row = { artist: string; affinity: number; rate: number | null; shown: number };

// taste.ts'in gün dilimi anahtarları → çeviri anahtarları. Şablon literaliyle
// üretmek tip güvenliğini kaybettirir (eksik anahtar derlemede yakalanmaz).
const PART_KEYS = {
  lateNight: "taste.part.lateNight",
  morning: "taste.part.morning",
  afternoon: "taste.part.afternoon",
  evening: "taste.part.evening",
  night: "taste.part.night",
} as const;

export default function TasteView() {
  const t = useT();
  const halfLife = useSettingsStore((s) => s.karmaHalfLifeDays);
  const [rows, setRows] = useState<Row[]>([]);
  const [report, setReport] = useState<AcceptanceReport | null>(null);
  const [buckets, setBuckets] = useState<ReturnType<typeof allBuckets>>([]);
  const [conf, setConf] = useState(0);
  const [bucketPlays, setBucketPlays] = useState(0);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [prefsVersion, setPrefsVersion] = useState(0);
  const [graph, setGraph] = useState({ seeds: 0, edges: 0 });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!isTauri()) return;
    setLoading(true);
    try {
      // force: sayfa açıldığında taze görünsün (10 dk'lık önbelleği atla).
      await Promise.all([
        buildTasteProfile(true),
        buildAcceptance(true),
        loadArtistPrefs(true),
        loadBlockedArtists(true),
      ]);
      const [signals, rep, gs] = await Promise.all([
        buildSignals(halfLife),
        acceptanceReport(),
        graphSize(),
      ]);
      const list: Row[] = [...signals.artistAffinity.entries()]
        .filter(([a, v]) => a.trim() !== "" && v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([artist, affinity]) => ({
          artist,
          affinity,
          rate: acceptanceRate(artist),
          shown: acceptanceShown(artist),
        }));
      setRows(list);
      setReport(rep);
      setBuckets(allBuckets());
      setConf(currentConfidence());
      setBucketPlays(currentBucketPlays());
      setBlocked(blockedArtists());
      setGraph(gs);
    } catch (e) {
      console.error("[resonance] zevk profili yüklenemedi:", e);
    } finally {
      setLoading(false);
    }
  }, [halfLife]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const applyPref = async (artist: string, weight: number) => {
    await setArtistPref(artist, weight);
    setPrefsVersion((v) => v + 1);
  };

  const applyBlock = async (artist: string) => {
    await blockArtist(artist);
    setBlocked(blockedArtists());
    setRows((rs) => rs.filter((r) => r.artist.toLowerCase() !== artist.toLowerCase()));
  };

  const cur = splitBucket(bucketOf());
  const maxAffinity = Math.max(0.0001, ...rows.map((r) => r.affinity));

  const partLabel = (part: string, weekend: boolean) =>
    `${t(weekend ? "taste.weekend" : "taste.weekday")} · ${t(
      PART_KEYS[part as keyof typeof PART_KEYS] ?? "taste.part.morning"
    )}`;

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t("taste.title")} subtitle={t("taste.subtitle")}>
        <button
          onClick={() => void reload()}
          className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-muted transition-colors hover:text-text"
        >
          <RotateCcw size={13} />
          {t("taste.refresh")}
        </button>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {loading && rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-faint">
            {t("taste.loading")}
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-faint">
            <Brain size={40} strokeWidth={1.5} />
            <p className="text-sm">{t("taste.empty")}</p>
          </div>
        ) : (
          <>
            {/* ── Şu anki bağlam ─────────────────────────────────────────── */}
            <section className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-accent">
                <Target size={15} />
                <h2 className="text-[11px] font-semibold uppercase tracking-wider">
                  {t("taste.nowContext")}
                </h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed">
                {t("taste.nowSummary", {
                  context: partLabel(cur.part, cur.weekend),
                  plays: bucketPlays,
                })}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.round(conf * 100)}%` }}
                  />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {t("taste.confidence", { pct: Math.round(conf * 100) })}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-faint">
                {t("taste.confidenceHelp")}
              </p>
            </section>

            {/* ── Öneri kalitesi (A3) ────────────────────────────────────── */}
            {report && report.total.shown > 0 && (
              <section className="mt-8">
                <div className="mb-3 flex items-center gap-2 text-faint">
                  <Compass size={14} />
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider">
                    {t("taste.quality")}
                  </h2>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Metric
                    value={`%${Math.round(
                      (report.total.accepted / report.total.shown) * 100
                    )}`}
                    label={t("taste.acceptRate")}
                    hint={t("taste.ofN", { n: report.total.shown })}
                  />
                  <Metric
                    value={
                      report.discovery.shown > 0
                        ? `%${Math.round(
                            (report.discovery.accepted / report.discovery.shown) * 100
                          )}`
                        : "—"
                    }
                    label={t("taste.discoveryRate")}
                    hint={t("taste.ofN", { n: report.discovery.shown })}
                  />
                  <Metric
                    value={String(graph.seeds)}
                    label={t("taste.graphArtists")}
                    hint={t("taste.graphEdges", { n: graph.edges })}
                  />
                </div>

                {report.weeks.length > 1 && (
                  <div className="mt-4">
                    <div className="flex h-20 items-end gap-1">
                      {report.weeks.slice(-12).map((w) => {
                        const pct = w.shown ? w.accepted / w.shown : 0;
                        return (
                          <div
                            key={w.start}
                            title={`${new Date(w.start).toLocaleDateString()} — %${Math.round(
                              pct * 100
                            )} (${w.accepted}/${w.shown})`}
                            className="flex-1 rounded-t bg-accent/70 transition-all hover:bg-accent"
                            style={{ height: `${Math.max(3, pct * 100)}%` }}
                          />
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-xs text-faint">
                      {t("taste.weeklyHelp")}
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* ── Sanatçı yakınlığı + elle düzeltme ──────────────────────── */}
            <section className="mt-8">
              <div className="mb-1 flex items-center gap-2 text-faint">
                <Brain size={14} />
                <h2 className="text-[11px] font-semibold uppercase tracking-wider">
                  {t("taste.artists")}
                </h2>
              </div>
              <p className="mb-3 text-xs text-faint">{t("taste.artistsHelp")}</p>

              {rows.map((r) => {
                const w = prefWeight(r.artist);
                return (
                  <div
                    key={`${r.artist}-${prefsVersion}`}
                    className="group flex items-center gap-3 border-b border-border/60 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm">{r.artist}</span>
                        {r.rate !== null && r.shown >= 4 && (
                          <span
                            title={t("taste.rateTip", { n: r.shown })}
                            className={`shrink-0 text-[11px] tabular-nums ${
                              r.rate >= 0.6
                                ? "text-up"
                                : r.rate <= 0.3
                                ? "text-down"
                                : "text-muted"
                            }`}
                          >
                            %{Math.round(r.rate * 100)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-accent/70"
                          style={{
                            width: `${(r.affinity / maxAffinity) * 100}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                      <PrefButton
                        active={w === PREF_LESS}
                        title={t("taste.less")}
                        onClick={() =>
                          void applyPref(
                            r.artist,
                            w === PREF_LESS ? PREF_NORMAL : PREF_LESS
                          )
                        }
                      >
                        <Minus size={13} />
                      </PrefButton>
                      <PrefButton
                        active={w === PREF_MORE}
                        title={t("taste.more")}
                        onClick={() =>
                          void applyPref(
                            r.artist,
                            w === PREF_MORE ? PREF_NORMAL : PREF_MORE
                          )
                        }
                      >
                        <Plus size={13} />
                      </PrefButton>
                      <PrefButton
                        title={t("taste.block")}
                        danger
                        onClick={() => void applyBlock(r.artist)}
                      >
                        <Ban size={13} />
                      </PrefButton>
                    </div>
                  </div>
                );
              })}
            </section>

            {/* ── Saat/gün profili ───────────────────────────────────────── */}
            {buckets.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {t("taste.byContext")}
                </h2>
                {buckets.map((b) => {
                  const s = splitBucket(b.bucket);
                  return (
                    <div
                      key={b.bucket}
                      className="flex items-center justify-between gap-4 border-b border-border/60 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm">{partLabel(s.part, s.weekend)}</div>
                        <div className="truncate text-xs text-muted">
                          {b.top.join(" · ") || t("taste.noPrediction")}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-faint">
                        {t("taste.confidence", {
                          pct: Math.round(b.confidence * 100),
                        })}
                      </span>
                    </div>
                  );
                })}
              </section>
            )}

            {/* ── Engellenenler ──────────────────────────────────────────── */}
            {blocked.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {t("taste.blocked")}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {blocked.map((a) => (
                    <button
                      key={a}
                      onClick={async () => {
                        await unblockArtist(a);
                        setBlocked(blockedArtists());
                        void reload();
                      }}
                      className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs text-muted transition-colors hover:text-text"
                    >
                      {a}
                      <RotateCcw size={11} />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <p className="mt-8 flex items-center gap-1.5 text-xs text-faint">
              <Network size={12} />
              {t("taste.footer")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({
  value,
  label,
  hint,
}: {
  value: string;
  label: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-[11px] text-faint">{hint}</div>
    </div>
  );
}

function PrefButton({
  children,
  title,
  onClick,
  active,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-6 w-6 place-items-center rounded transition-colors ${
        active
          ? "bg-accent text-bg"
          : danger
          ? "text-faint hover:bg-surface-2 hover:text-down"
          : "text-faint hover:bg-surface-2 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
