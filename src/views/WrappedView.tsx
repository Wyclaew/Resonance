import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Clock,
  Music2,
  User,
  Compass,
  Copy,
  ChevronLeft,
  Trophy,
} from "lucide-react";
import { useT } from "../lib/i18n";
import { getDb, isTauri } from "../lib/db";
import { useAppStore } from "../store/useAppStore";
import { useToastStore } from "../store/useToastStore";

// ═══════════════════════════════════════════════════════════════════════════
// YILLIK ÖZET ("Wrapped") — paylaşılabilir yıl karnesi.
//
// Kaynak: play_history ⨝ tracks (senkronlanıyor → TÜM cihazların toplamı) +
// recommendation_history (Resonance'ın kendi karnesi: kaç yeni sanatçı/tür
// önerdim, kaçı tuttu). Ayrı bir tablo tutulmuyor; her şey türetiliyor.
//
// ⚠️ Tasarım kararı: ekran görüntüsü alınmaya UYGUN olmalı (kullanıcı bunu
// hikâyesinde paylaşacak) → tek kolon, büyük rakamlar, koyu zemin, altta
// uygulama imzası. Görsel dosya ÜRETMİYORUZ: canvas'a çizip kaydetmek çok
// daha kırılgan ve her tema/dil için ayrı bakım demek.
// ═══════════════════════════════════════════════════════════════════════════

type Row = { name: string; plays: number; ms: number };

type Data = {
  totalMs: number;
  plays: number;
  artists: number;
  newArtists: number;
  topArtists: Row[];
  topTracks: Row[];
  peakHour: number;
  recommended: number;
  recAccepted: number;
  newGenres: number;
  longestStreak: number;
};

const EMPTY: Data = {
  totalMs: 0,
  plays: 0,
  artists: 0,
  newArtists: 0,
  topArtists: [],
  topTracks: [],
  peakHour: 0,
  recommended: 0,
  recAccepted: 0,
  newGenres: 0,
  longestStreak: 0,
};

export default function WrappedView() {
  const t = useT();
  const navigate = useAppStore((s) => s.navigate);
  const toast = useToastStore((s) => s.show);
  const now = new Date();
  const [year, setYear] = useState<number | "12m">(now.getFullYear());
  const [d, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    if (year === "12m") {
      return { from: Date.now() - 365 * 24 * 3600 * 1000, to: Date.now() };
    }
    return {
      from: new Date(year, 0, 1).getTime(),
      to: new Date(year + 1, 0, 1).getTime(),
    };
  }, [year]);

  const load = useCallback(async () => {
    if (!isTauri()) return;
    setLoading(true);
    try {
      const db = await getDb();
      const { from, to } = range;

      const tot = await db.select<{ ms: number; c: number; a: number }[]>(
        `SELECT COALESCE(SUM(h.ms_played),0) AS ms, COUNT(*) AS c,
                COUNT(DISTINCT t.artist) AS a
           FROM play_history h JOIN tracks t ON t.id = h.track_id
          WHERE h.played_at >= $1 AND h.played_at < $2`,
        [from, to]
      );
      const topArtists = await db.select<Row[]>(
        `SELECT t.artist AS name, COUNT(*) AS plays, SUM(h.ms_played) AS ms
           FROM play_history h JOIN tracks t ON t.id = h.track_id
          WHERE h.played_at >= $1 AND h.played_at < $2 AND t.artist <> ''
          GROUP BY t.artist ORDER BY ms DESC LIMIT 5`,
        [from, to]
      );
      const topTracks = await db.select<Row[]>(
        `SELECT t.title AS name, COUNT(*) AS plays, SUM(h.ms_played) AS ms
           FROM play_history h JOIN tracks t ON t.id = h.track_id
          WHERE h.played_at >= $1 AND h.played_at < $2
          GROUP BY t.id ORDER BY plays DESC, ms DESC LIMIT 5`,
        [from, to]
      );
      // "Yeni keşfedilen sanatçı": aralıkta dinlendi, aralıktan ÖNCE hiç yok.
      const fresh = await db.select<{ c: number }[]>(
        `SELECT COUNT(*) AS c FROM (
           SELECT t.artist FROM play_history h JOIN tracks t ON t.id = h.track_id
            WHERE h.played_at >= $1 AND h.played_at < $2 AND t.artist <> ''
            GROUP BY t.artist
           EXCEPT
           SELECT t.artist FROM play_history h JOIN tracks t ON t.id = h.track_id
            WHERE h.played_at < $1 AND t.artist <> ''
            GROUP BY t.artist)`,
        [from, to]
      );
      const hours = await db.select<{ hour: number; ms: number }[]>(
        `SELECT hour, SUM(ms_played) AS ms FROM play_history
          WHERE played_at >= $1 AND played_at < $2 GROUP BY hour
          ORDER BY ms DESC LIMIT 1`,
        [from, to]
      );
      const rec = await db.select<{ c: number }[]>(
        `SELECT COUNT(*) AS c FROM recommendation_history
          WHERE recommended_at >= $1 AND recommended_at < $2`,
        [from, to]
      );
      // Kabul edilen öneri: önerildikten sonra en az %40'ı dinlenmiş.
      const accepted = await db.select<{ c: number }[]>(
        `SELECT COUNT(*) AS c FROM recommendation_history r
           JOIN tracks t ON t.id = r.track_id
          WHERE r.recommended_at >= $1 AND r.recommended_at < $2
            AND t.duration_ms > 0
            AND (SELECT MAX(h.ms_played) FROM play_history h
                  WHERE h.track_id = r.track_id
                    AND h.played_at >= r.recommended_at) * 1.0
                / t.duration_ms >= 0.4`,
        [from, to]
      );
      // Yeni müzik türü: bu aralıkta ilk kez karşılaşılan etiket sayısı
      // (artist_tags yerelde birikiyor — tür alanının tek kaynağı).
      const genres = await db.select<{ c: number }[]>(
        `SELECT COUNT(DISTINCT g.tag) AS c
           FROM artist_tags g
           JOIN tracks t ON lower(t.artist) = g.artist
           JOIN play_history h ON h.track_id = t.id
          WHERE h.played_at >= $1 AND h.played_at < $2`,
        [from, to]
      );
      // En uzun dinleme serisi (arka arkaya kaç gün).
      const days = await db.select<{ d: number }[]>(
        `SELECT DISTINCT CAST(played_at / 86400000 AS INTEGER) AS d
           FROM play_history WHERE played_at >= $1 AND played_at < $2
          ORDER BY d ASC`,
        [from, to]
      );
      let streak = 0;
      let best = 0;
      let prev: number | null = null;
      for (const row of days) {
        streak = prev !== null && row.d === prev + 1 ? streak + 1 : 1;
        if (streak > best) best = streak;
        prev = row.d;
      }

      setData({
        totalMs: tot[0]?.ms ?? 0,
        plays: tot[0]?.c ?? 0,
        artists: tot[0]?.a ?? 0,
        newArtists: fresh[0]?.c ?? 0,
        topArtists,
        topTracks,
        peakHour: hours[0]?.hour ?? 0,
        recommended: rec[0]?.c ?? 0,
        recAccepted: accepted[0]?.c ?? 0,
        newGenres: genres[0]?.c ?? 0,
        longestStreak: best,
      });
    } catch (e) {
      console.error("[resonance] yıllık özet hesaplanamadı:", e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const minutes = Math.round(d.totalMs / 60000);
  const label = year === "12m" ? t("wrapped.last12m") : String(year);

  const copySummary = async () => {
    const lines = [
      `Resonance ${label}`,
      t("wrapped.copyMinutes", { minutes, plays: d.plays }),
      t("wrapped.copyArtists", { artists: d.artists, newArtists: d.newArtists }),
      d.topArtists.length
        ? t("wrapped.copyTop", { list: d.topArtists.map((a) => a.name).join(", ") })
        : "",
      t("wrapped.copyRec", { count: d.recommended, accepted: d.recAccepted }),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast(t("wrapped.copied"), "success");
    } catch {
      toast(t("wrapped.copyFailed"), "error");
    }
  };

  const years = [now.getFullYear(), now.getFullYear() - 1];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 px-8 pb-4 pt-7">
        <button
          onClick={() => navigate("stats")}
          className="flex items-center gap-1 text-sm text-muted transition-colors hover:text-text"
        >
          <ChevronLeft size={16} />
          {t("wrapped.back")}
        </button>
        <div className="flex gap-1 rounded-md bg-surface-2 p-1">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                year === y ? "bg-accent font-medium text-bg" : "text-muted"
              }`}
            >
              {y}
            </button>
          ))}
          <button
            onClick={() => setYear("12m")}
            className={`rounded px-2.5 py-1 text-xs transition-colors ${
              year === "12m" ? "bg-accent font-medium text-bg" : "text-muted"
            }`}
          >
            {t("wrapped.last12m")}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        {loading ? (
          <p className="py-20 text-center text-sm text-faint">
            {t("wrapped.loading")}
          </p>
        ) : d.plays === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-faint">
            <Sparkles size={40} strokeWidth={1.5} />
            <p className="text-sm">{t("wrapped.empty", { label })}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-xl">
            {/* Kapak — ekran görüntüsüne uygun büyük başlık */}
            <section className="overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-b from-accent/15 to-transparent p-8 text-center">
              <p className="text-xs uppercase tracking-[0.2em] text-accent">
                Resonance · {label}
              </p>
              <p className="mt-6 text-6xl font-semibold tabular-nums">
                {minutes.toLocaleString()}
              </p>
              <p className="mt-1 text-sm text-muted">{t("wrapped.minutes")}</p>
              <p className="mx-auto mt-5 max-w-sm text-sm leading-relaxed text-muted">
                {/* İLK YIL: tüm sanatçılar "yeni" çıkar (öncesinde geçmiş yok)
                    → "361 sanatçı ve 361 yeni isim" saçma görünüyordu. */}
                {d.newArtists >= d.artists
                  ? t("wrapped.headlineFirst", {
                      plays: d.plays,
                      artists: d.artists,
                    })
                  : t("wrapped.headline", {
                      plays: d.plays,
                      artists: d.artists,
                      newArtists: d.newArtists,
                    })}
              </p>
            </section>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Card
                icon={<Clock size={15} />}
                value={`${String(d.peakHour).padStart(2, "0")}:00`}
                label={t("wrapped.peakHour")}
              />
              <Card
                icon={<Trophy size={15} />}
                value={t("wrapped.days", { n: d.longestStreak })}
                label={t("wrapped.streak")}
              />
              <Card
                icon={<User size={15} />}
                value={String(d.newArtists)}
                label={t("wrapped.newArtists")}
              />
              <Card
                icon={<Compass size={15} />}
                value={String(d.newGenres)}
                label={t("wrapped.newGenres")}
              />
            </div>

            <TopList
              title={t("wrapped.topArtists")}
              rows={d.topArtists}
              icon={<User size={14} />}
            />
            <TopList
              title={t("wrapped.topTracks")}
              rows={d.topTracks}
              icon={<Music2 size={14} />}
            />

            {/* Resonance'ın kendi karnesi */}
            <section className="mt-6 rounded-xl border border-border bg-surface p-5">
              <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                <Sparkles size={13} className="text-accent" />
                {t("wrapped.resonanceCard")}
              </h2>
              <p className="mt-2 text-sm leading-relaxed">
                {t("wrapped.resonanceBody", {
                  count: d.recommended,
                  accepted: d.recAccepted,
                  pct:
                    d.recommended > 0
                      ? Math.round((d.recAccepted / d.recommended) * 100)
                      : 0,
                })}
              </p>
            </section>

            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-xs text-faint">{t("wrapped.shareHint")}</p>
              <button
                onClick={() => void copySummary()}
                className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted transition-colors hover:text-text"
              >
                <Copy size={13} />
                {t("wrapped.copy")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-accent">{icon}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function TopList({
  title,
  rows,
  icon,
}: {
  title: string;
  rows: Row[];
  icon: React.ReactNode;
}) {
  const t = useT();
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => r.ms));
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      {rows.map((r, i) => (
        <div key={r.name + i} className="mb-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm">
              <span className="mr-2 text-base font-semibold tabular-nums text-accent">
                {i + 1}
              </span>
              {r.name}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-faint">
              {t("wrapped.minShort", { n: Math.round(r.ms / 60000) })}
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
