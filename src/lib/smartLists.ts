import type { Track } from "../types";
import { getDb, isTauri } from "./db";
import type { TrKey } from "./i18n";

// ═══════════════════════════════════════════════════════════════════════════
// AKILLI LİSTELER — kendini güncelleyen, sorgu tabanlı listeler.
//
// Kalıcı bir `playlists` satırı YOKTUR: her açılışta `play_history`'den
// yeniden hesaplanır. Böylece hem senkron yükü olmaz (iki cihazda ayrı satır
// üretip çakışmaz) hem de liste hep güncel kalır.
//
// ⚠️ Tüm sorgular `tracks` ile JOIN eder; `play_history`'de yetim kayıt
// olabilir (bkz. CLAUDE.md #13) — JOIN onları zaten eler.
// ═══════════════════════════════════════════════════════════════════════════

export type SmartListId =
  | "mostPlayed"
  | "neverFinished"
  | "night"
  | "forgotten"
  | "completed";

export interface SmartList {
  id: SmartListId;
  labelKey: TrKey;
  descKey: TrKey;
}

export const SMART_LISTS: SmartList[] = [
  { id: "mostPlayed", labelKey: "smart.mostPlayed", descKey: "smart.mostPlayedDesc" },
  { id: "completed", labelKey: "smart.completed", descKey: "smart.completedDesc" },
  { id: "night", labelKey: "smart.night", descKey: "smart.nightDesc" },
  { id: "forgotten", labelKey: "smart.forgotten", descKey: "smart.forgottenDesc" },
  { id: "neverFinished", labelKey: "smart.neverFinished", descKey: "smart.neverFinishedDesc" },
];

const SELECT = `SELECT t.id, t.source, t.source_id AS sourceId, t.title, t.artist,
                       t.duration_ms AS durationMs, t.thumbnail`;

function queryFor(id: SmartListId): { sql: string; params: unknown[] } {
  const days30 = Date.now() - 30 * 24 * 3600 * 1000;
  switch (id) {
    case "mostPlayed":
      return {
        sql: `${SELECT}, COUNT(*) AS n
                FROM play_history h JOIN tracks t ON t.id = h.track_id
               WHERE h.played_at >= $1
               GROUP BY t.id ORDER BY n DESC, SUM(h.ms_played) DESC LIMIT 50`,
        params: [days30],
      };
    case "completed":
      // Sonuna kadar dinlenenler (>%70) — "gerçekten sevdiklerim".
      return {
        sql: `${SELECT}, COUNT(*) AS n
                FROM play_history h JOIN tracks t ON t.id = h.track_id
               WHERE t.duration_ms > 0
                 AND h.ms_played * 1.0 / t.duration_ms > 0.7
               GROUP BY t.id ORDER BY n DESC LIMIT 50`,
        params: [],
      };
    case "night":
      // Gece kuşağı: 22:00–05:00 arasında dinlenenler.
      return {
        sql: `${SELECT}, COUNT(*) AS n
                FROM play_history h JOIN tracks t ON t.id = h.track_id
               WHERE (h.hour >= 22 OR h.hour < 5)
               GROUP BY t.id ORDER BY n DESC LIMIT 50`,
        params: [],
      };
    case "forgotten":
      // Bir zamanlar sevdiğin ama 60 gündür çalmadıkların.
      return {
        sql: `${SELECT}, MAX(h.played_at) AS last, COUNT(*) AS n
                FROM play_history h JOIN tracks t ON t.id = h.track_id
               WHERE t.duration_ms > 0
               GROUP BY t.id
              HAVING n >= 2 AND last < $1
               ORDER BY n DESC LIMIT 50`,
        params: [Date.now() - 60 * 24 * 3600 * 1000],
      };
    case "neverFinished":
      // Hep atladıkların: en az 2 kez çalınmış ve HİÇ tamamlanmamış.
      return {
        sql: `${SELECT}, COUNT(*) AS n
                FROM play_history h JOIN tracks t ON t.id = h.track_id
               WHERE t.duration_ms > 0
               GROUP BY t.id
              HAVING n >= 2
                 AND MAX(h.ms_played * 1.0 / t.duration_ms) < 0.5
               ORDER BY n DESC LIMIT 50`,
        params: [],
      };
  }
}

export async function runSmartList(id: SmartListId): Promise<Track[]> {
  if (!isTauri()) return [];
  try {
    const db = await getDb();
    const { sql, params } = queryFor(id);
    const rows = await db.select<
      {
        id: string;
        source: string;
        sourceId: string;
        title: string;
        artist: string;
        durationMs: number;
        thumbnail: string | null;
      }[]
    >(sql, params);
    return rows.map((r) => ({
      id: r.id,
      source: r.source as Track["source"],
      sourceId: r.sourceId,
      title: r.title,
      artist: r.artist,
      durationMs: r.durationMs,
      thumbnail: r.thumbnail ?? undefined,
    }));
  } catch (e) {
    console.error("[resonance] akıllı liste çalıştırılamadı:", id, e);
    return [];
  }
}
