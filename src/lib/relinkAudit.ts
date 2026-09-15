import { invoke } from "@tauri-apps/api/core";
import { getDb, isTauri } from "./db";
import { songCore } from "./recommender";
import { loadSettings, setSetting } from "./settings";
import { notifyLocalChange } from "./sync/engine";

// ═══════════════════════════════════════════════════════════════════════════
// YENİDEN BAĞLANMIŞ PARÇALARIN DENETİMİ (v1.9.5)
//
// ⛔ NEDEN: bir video çalınamayınca uygulama "aynı şarkının başka yüklemesini"
// bulup `tracks.source_id`'yi değiştiriyor (`find_alternative`). Eşleşme
// v1.9.3'e kadar YALNIZ süreye bakıyordu ve mobilde YANLIŞ şarkıya bağladı
// ("Midnight City" → M83'ün "Outro"su), üstelik senkronla diğer cihazlara da
// geçti. Eşleştirme düzeltildi ama ESKİ yanlış bağlantılar duruyor.
//
// Denetim: `id` ("youtube:ORİJİNAL") ile `source_id` farklıysa parça yeniden
// bağlanmıştır. Yeni videonun gerçek başlığını YouTube oEmbed'den alıp
// parçanın başlığıyla karşılaştırırız. HİÇ ortak kelime yoksa bağlantı geri
// alınır (orijinal videoya döner); çalınamıyorsa düzeltilmiş eşleştirmeyle
// yeniden bağlanır.
//
// ⚠️ TEMKİNLİ: yalnız "hiç ortak kelime yok" durumunda geri alır. Zayıf bir
// eşleşmeyi bozup çalışan bir bağlantıyı kırmaktansa, yanlışı kaçırmak yeğdir.
// ═══════════════════════════════════════════════════════════════════════════

const LAST_KEY = "relink.lastAudit";
const EVERY_MS = 7 * 24 * 60 * 60 * 1000;

interface Row {
  id: string;
  source_id: string;
  title: string;
  artist: string;
}

export async function auditRelinks(force = false): Promise<number> {
  if (!isTauri()) return 0;
  try {
    if (!force) {
      const last = Number((await loadSettings())[LAST_KEY] ?? 0);
      if (Number.isFinite(last) && Date.now() - last < EVERY_MS) return 0;
    }
    const db = await getDb();
    const rows = await db.select<Row[]>(
      `SELECT id, source_id, title, artist FROM tracks
        WHERE source = 'youtube' AND id <> 'youtube:' || source_id
        LIMIT 100`
    );
    if (rows.length === 0) {
      await setSetting(LAST_KEY, String(Date.now())).catch(() => {});
      return 0;
    }
    const metas = await invoke<{ id: string; title: string; author: string }[]>(
      "youtube_oembed",
      { ids: rows.map((r) => r.source_id) }
    );
    const byVid = new Map(metas.map((m) => [m.id, m]));
    let reverted = 0;
    for (const r of rows) {
      const m = byVid.get(r.source_id);
      if (!m) continue; // video kapalı/silinmiş → dokunma, çalma yolu halleder
      const want = new Set(songCore(r.title, r.artist).split(" ").filter(Boolean));
      const got = new Set(songCore(m.title, m.author).split(" ").filter(Boolean));
      if (want.size === 0 || got.size === 0) continue;
      let common = 0;
      for (const w of want) if (got.has(w)) common++;
      if (common > 0) continue; // en az bir ortak kelime → kabul

      const original = r.id.slice("youtube:".length);
      await db.execute(
        `UPDATE tracks SET source_id = $1, updated_at = $2 WHERE id = $3`,
        [original, Date.now(), r.id]
      );
      reverted++;
      console.warn(
        `[resonance] yanlış bağlantı geri alındı: "${r.title}" → "${m.title}" (${r.source_id})`
      );
    }
    await setSetting(LAST_KEY, String(Date.now())).catch(() => {});
    if (reverted > 0) notifyLocalChange();
    return reverted;
  } catch (e) {
    console.warn("[resonance] bağlantı denetimi başarısız:", e);
    return 0;
  }
}
