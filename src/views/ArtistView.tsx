import { useCallback, useEffect, useState } from "react";
import { Radio, Minus, Plus, Ban, Loader2, User, Clock } from "lucide-react";
import ViewHeader from "../components/ViewHeader";
import TrackRow from "../components/TrackRow";
import type { Track } from "../types";
import { useT } from "../lib/i18n";
import { getDb, isTauri } from "../lib/db";
import { formatMs } from "../lib/format";
import { usePlayerStore } from "../store/usePlayerStore";
import { useAppStore } from "../store/useAppStore";
import { useToastStore } from "../store/useToastStore";
import {
  PREF_LESS,
  PREF_MORE,
  PREF_NORMAL,
  loadArtistPrefs,
  prefWeight,
  setArtistPref,
} from "../lib/prefs";
import { blockArtist } from "../lib/blocked";
import { acceptanceRate, buildAcceptance } from "../lib/acceptance";

// ═══════════════════════════════════════════════════════════════════════════
// SANATÇI SAYFASI — sanatçı adı bugüne kadar hiçbir yere tıklanmıyordu.
//
// Tek yerde toplar: bu sanatçıyla geçmişin (kaç kez, ne zaman, ne kadar),
// kütüphanendeki parçaları, radyosunu başlatma ve model kontrolleri
// (daha çok / daha az / engelle).
// ═══════════════════════════════════════════════════════════════════════════

type Row = Track & { plays: number; ms: number; last: number };

export default function ArtistView({ artist }: { artist: string }) {
  const t = useT();
  const navigate = useAppStore((s) => s.navigate);
  const playNow = usePlayerStore((s) => s.playNow);
  const startSmartShuffle = usePlayerStore((s) => s.startSmartShuffle);
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const toast = useToastStore((s) => s.show);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ plays: 0, ms: 0, first: 0, last: 0 });
  const [prefVersion, setPrefVersion] = useState(0);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!isTauri() || !artist) return;
    try {
      await Promise.all([loadArtistPrefs(true), buildAcceptance()]);
      const db = await getDb();
      // Bu sanatçının bilinen parçaları + dinleme sayıları.
      // ⚠️ deleted = 0: tombstone'lu satırlar gösterilmemeli (docs/SYNC.md).
      const list = await db.select<
        {
          id: string;
          source: string;
          sourceId: string;
          title: string;
          artist: string;
          durationMs: number;
          thumbnail: string | null;
          plays: number;
          ms: number;
          last: number;
        }[]
      >(
        `SELECT t.id, t.source, t.source_id AS sourceId, t.title, t.artist,
                t.duration_ms AS durationMs, t.thumbnail,
                COUNT(h.id) AS plays,
                COALESCE(SUM(h.ms_played), 0) AS ms,
                COALESCE(MAX(h.played_at), 0) AS last
           FROM tracks t
           LEFT JOIN play_history h ON h.track_id = t.id
          WHERE lower(t.artist) = lower($1)
          GROUP BY t.id
          ORDER BY plays DESC, last DESC
          LIMIT 100`,
        [artist]
      );
      setRows(
        list.map((r) => ({
          id: r.id,
          source: r.source as Track["source"],
          sourceId: r.sourceId,
          title: r.title,
          artist: r.artist,
          durationMs: r.durationMs,
          thumbnail: r.thumbnail ?? undefined,
          plays: r.plays,
          ms: r.ms,
          last: r.last,
        }))
      );

      const tot = await db.select<
        { plays: number; ms: number; first: number; last: number }[]
      >(
        `SELECT COUNT(*) AS plays, COALESCE(SUM(h.ms_played),0) AS ms,
                COALESCE(MIN(h.played_at),0) AS first,
                COALESCE(MAX(h.played_at),0) AS last
           FROM play_history h JOIN tracks t ON t.id = h.track_id
          WHERE lower(t.artist) = lower($1)`,
        [artist]
      );
      if (tot[0]) setTotals(tot[0]);
    } catch (e) {
      console.error("[resonance] sanatçı sayfası yüklenemedi:", e);
    }
  }, [artist]);

  useEffect(() => {
    void load();
  }, [load]);

  const w = prefWeight(artist);
  const rate = acceptanceRate(artist);

  const applyPref = async (weight: number) => {
    await setArtistPref(artist, weight);
    setPrefVersion((v) => v + 1);
  };

  // "Radyosunu başlat": bu sanatçının parçalarından akıllı karışık.
  const startRadio = async () => {
    if (rows.length === 0 || starting) return;
    setStarting(true);
    try {
      await startSmartShuffle(rows, `artist:${artist}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full flex-col" key={prefVersion}>
      <ViewHeader
        title={artist}
        subtitle={t("artist.subtitle", { count: rows.length })}
      >
        <button
          onClick={() => void startRadio()}
          disabled={rows.length === 0 || starting}
          className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {starting ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Radio size={15} />
          )}
          {t("artist.startRadio")}
        </button>
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {/* Özet + model kontrolleri */}
        <section className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-xs text-accent">
            <User size={13} />
            {t("artist.yourHistory")}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed">
            {totals.plays > 0
              ? t("artist.historyBody", {
                  plays: totals.plays,
                  total: formatMs(totals.ms),
                  first: new Date(totals.first).toLocaleDateString(),
                })
              : t("artist.noHistory")}
          </p>
          {rate !== null && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <Clock size={11} />
              {t("artist.acceptance", { pct: Math.round(rate * 100) })}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <PrefBtn
              active={w === PREF_MORE}
              onClick={() => void applyPref(w === PREF_MORE ? PREF_NORMAL : PREF_MORE)}
            >
              <Plus size={13} /> {t("taste.more")}
            </PrefBtn>
            <PrefBtn
              active={w === PREF_LESS}
              onClick={() => void applyPref(w === PREF_LESS ? PREF_NORMAL : PREF_LESS)}
            >
              <Minus size={13} /> {t("taste.less")}
            </PrefBtn>
            <PrefBtn
              danger
              onClick={async () => {
                await blockArtist(artist);
                toast(t("discover.blocked", { artist }), "info");
                navigate("library");
              }}
            >
              <Ban size={13} /> {t("taste.block")}
            </PrefBtn>
          </div>
        </section>

        {/* Parçalar */}
        <section className="mt-6">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            {t("artist.tracks")}
          </div>
          {rows.length === 0 ? (
            <p className="py-8 text-sm text-faint">{t("artist.noTracks")}</p>
          ) : (
            rows.map((tr, i) => (
              <TrackRow
                key={tr.id}
                track={tr}
                index={i}
                isCurrent={current?.id === tr.id}
                isPlaying={status === "playing"}
                isLoading={status === "loading"}
                onPlay={() => playNow(tr, rows, `artist:${artist}`)}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function PrefBtn({
  children,
  onClick,
  active,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-accent bg-accent text-bg"
          : danger
          ? "border-border text-muted hover:border-down hover:text-down"
          : "border-border text-muted hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
