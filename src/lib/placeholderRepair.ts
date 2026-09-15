import { invoke } from "@tauri-apps/api/core";
import { getDb, isTauri } from "./db";
import { notifyLocalChange } from "./sync/engine";

// ═══════════════════════════════════════════════════════════════════════════
// YER TUTUCU PARÇALARIN ADINI DOLDUR (yalnız masaüstü, v1.9.3).
//
// Senkron, parçası hiç gelmeyen bir liste üyeliğini kaybetmemek için başlığı
// boş bir parça satırı açar (`ensureParentTracks`, engine.ts). Burada adları
// YouTube oEmbed'den doldurulur ve `updated_at` tazelenir → satır buluta da
// çıkar, diğer cihazlar da onarılmış hâlini alır.
// ═══════════════════════════════════════════════════════════════════════════

/** Parça bilgileri toplu değişti — açık sayfalar kendini yeniden okusun. */
export const LIBRARY_CHANGED_EVENT = "resonance:library-changed";

let running = false;
const failedThisSession = new Set<string>();

export async function repairPlaceholderTracks(): Promise<number> {
  if (!isTauri() || running) return 0;
  running = true;
  try {
    const db = await getDb();
    const rows = await db.select<{ id: string; source_id: string }[]>(
      `SELECT id, source_id FROM tracks
        WHERE source = 'youtube' AND title = '' LIMIT 400`
    );
    const todo = rows.filter((r) => !failedThisSession.has(r.id));
    if (todo.length === 0) return 0;
    const metas = await invoke<
      { id: string; title: string; author: string; thumbnail?: string }[]
    >("youtube_oembed", { ids: todo.map((r) => r.source_id) });
    const byVid = new Map(metas.map((m) => [m.id, m]));
    const now = Date.now();
    let fixed = 0;
    for (const r of todo) {
      const m = byVid.get(r.source_id);
      if (!m) {
        failedThisSession.add(r.id);
        continue;
      }
      await db.execute(
        `UPDATE tracks SET title = $1, artist = $2,
                thumbnail = COALESCE(thumbnail, $3), updated_at = $4
          WHERE id = $5 AND title = ''`,
        [m.title, m.author, m.thumbnail ?? null, now, r.id]
      );
      fixed++;
    }
    if (fixed > 0) {
      console.warn(`[resonance] ${fixed} yer tutucu parçanın adı dolduruldu`);
      notifyLocalChange();
    }
    if (todo.length > fixed) {
      console.warn(`[resonance] ${todo.length - fixed} yer tutucu parçanın adı bulunamadı`);
    }
    return fixed;
  } catch (e) {
    console.warn("[resonance] yer tutucu onarımı başarısız:", e);
    return 0;
  } finally {
    running = false;
  }
}
