import { useEffect, useState } from "react";
import { BarChart3, Clock, Music2, User } from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import { useT } from "../lib/i18n";
import { getDb, isTauri } from "../lib/db";
import { formatMs } from "../lib/format";

// Dinleme etkinliği & analiz. Kaynak: `play_history` (senkronlanıyor) →
// istatistikler CİHAZLAR ARASI ORTAK. Ayrı bir analiz tablosu tutulmuyor.

type TopRow = { name: string; plays: number; ms: number };
type DayRow = { day: string; title: string; artist: string; at: number };

export default function StatsView() {
  const t = useT();
  const [range, setRange] = useState<7 | 30 | 365>(30);
  const [totalMs, setTotalMs] = useState(0);
  const [totalPlays, setTotalPlays] = useState(0);
  const [artists, setArtists] = useState<TopRow[]>([]);
  const [tracks, setTracks] = useState<TopRow[]>([]);
  const [byHour, setByHour] = useState<number[]>([]);
  const [recent, setRecent] = useState<DayRow[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    (async () => {
      try {
        const db = await getDb();
        const since = Date.now() - range * 24 * 3600 * 1000;

        const tot = await db.select<{ ms: number; c: number }[]>(
          `SELECT COALESCE(SUM(ms_played),0) AS ms, COUNT(*) AS c
           FROM play_history WHERE played_at >= $1`,
          [since]
        );
        const art = await db.select<TopRow[]>(
          `SELECT t.artist AS name, COUNT(*) AS plays, SUM(h.ms_played) AS ms
           FROM play_history h JOIN tracks t ON t.id = h.track_id
           WHERE h.played_at >= $1 AND t.artist <> ''
           GROUP BY t.artist ORDER BY ms DESC LIMIT 10`,
          [since]
        );
        const trk = await db.select<TopRow[]>(
          `SELECT t.title AS name, COUNT(*) AS plays, SUM(h.ms_played) AS ms
           FROM play_history h JOIN tracks t ON t.id = h.track_id
           WHERE h.played_at >= $1
           GROUP BY t.id ORDER BY plays DESC, ms DESC LIMIT 10`,
          [since]
        );
        const hrs = await db.select<{ hour: number; ms: number }[]>(
          `SELECT hour, SUM(ms_played) AS ms FROM play_history
           WHERE played_at >= $1 GROUP BY hour`,
          [since]
        );
        const rec = await db.select<
          { title: string; artist: string; at: number }[]
        >(
          `SELECT t.title, t.artist, h.played_at AS at
           FROM play_history h JOIN tracks t ON t.id = h.track_id
           WHERE h.played_at >= $1 AND h.ms_played > 20000
           ORDER BY h.played_at DESC LIMIT 60`,
          [since]
        );

        if (!alive) return;
        setTotalMs(tot[0]?.ms ?? 0);
        setTotalPlays(tot[0]?.c ?? 0);
        setArtists(art);
        setTracks(trk);
        const arr = Array(24).fill(0);
        for (const h of hrs) arr[h.hour] = h.ms;
        setByHour(arr);
        setRecent(
          rec.map((r) => ({
            day: new Date(r.at).toLocaleDateString(),
            title: r.title,
            artist: r.artist,
            at: r.at,
          }))
        );
      } catch (e) {
        console.error("[resonance] istatistik okunamadı:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range]);

  const maxHour = Math.max(1, ...byHour);
  const hours = Math.round(totalMs / 3600000);

  // Günlere göre grupla (tarih başlıklı liste).
  const grouped: { day: string; items: DayRow[] }[] = [];
  for (const r of recent) {
    const last = grouped[grouped.length - 1];
    if (last && last.day === r.day) last.items.push(r);
    else grouped.push({ day: r.day, items: [r] });
  }

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t("stats.title")} subtitle={t("stats.subtitle")}>
        <div className="flex gap-1 rounded-md bg-surface-2 p-1">
          {([7, 30, 365] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                range === r ? "bg-accent font-medium text-bg" : "text-muted"
              }`}
            >
              {r === 365 ? t("stats.year") : t("stats.days", { n: r })}
            </button>
          ))}
        </div>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {totalPlays === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-faint">
            <BarChart3 size={40} strokeWidth={1.5} />
            <p className="text-sm">{t("stats.empty")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                icon={<Clock size={15} />}
                value={`${hours} ${t("stats.hoursShort")}`}
                label={t("stats.listened")}
              />
              <Stat
                icon={<Music2 size={15} />}
                value={String(totalPlays)}
                label={t("stats.plays")}
              />
              <Stat
                icon={<User size={15} />}
                value={String(artists.length)}
                label={t("stats.artists")}
              />
            </div>

            {/* Saat dağılımı */}
            <section className="mt-8">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                {t("stats.byHour")}
              </h2>
              <div className="flex h-24 items-end gap-[3px]">
                {byHour.map((ms, h) => (
                  <div
                    key={h}
                    title={`${h}:00 — ${formatMs(ms)}`}
                    className="flex-1 rounded-t bg-accent/70 transition-all hover:bg-accent"
                    style={{ height: `${Math.max(2, (ms / maxHour) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-faint">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
            </section>

            <div className="mt-8 grid gap-8 lg:grid-cols-2">
              <TopList title={t("stats.topArtists")} rows={artists} />
              <TopList title={t("stats.topTracks")} rows={tracks} />
            </div>

            {/* Tarihe göre dinleme geçmişi */}
            <section className="mt-8">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                {t("stats.history")}
              </h2>
              {grouped.map((g) => (
                <div key={g.day} className="mb-4">
                  <div className="mb-1 text-xs font-medium text-muted">
                    {g.day}
                  </div>
                  {g.items.map((it, i) => (
                    <div
                      key={`${it.at}-${i}`}
                      className="flex items-center justify-between gap-4 border-b border-border/60 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">{it.title}</div>
                        <div className="truncate text-xs text-muted">
                          {it.artist}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-faint">
                        {new Date(it.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 text-accent">{icon}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function TopList({ title, rows }: { title: string; rows: TopRow[] }) {
  const t = useT();
  const max = Math.max(1, ...rows.map((r) => r.ms));
  return (
    <section>
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {title}
      </h2>
      {rows.length === 0 && (
        <p className="text-sm text-faint">{t("stats.empty")}</p>
      )}
      {rows.map((r, i) => (
        <div key={r.name + i} className="mb-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm">
              <span className="mr-2 text-xs tabular-nums text-faint">
                {i + 1}
              </span>
              {r.name}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {formatMs(r.ms)}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent/70"
              style={{ width: `${(r.ms / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
