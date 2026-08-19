import type { QueueItem } from "../types";
import { getDb, isTauri } from "./db";
import { getDeviceId } from "./device";
import { notifyLocalChange } from "./sync/engine";

// ═══════════════════════════════════════════════════════════════════════════
// CİHAZLAR ARASI KUYRUK — "Windows'ta bıraktığım Keşfet seti Mac'te açılsın"
//
// ⚠️ ESKİ DAVRANIŞ VE NEDEN YETMEDİ: kuyruk `settings.resumeState` içinde
// tutuluyordu ve `settings` BİLEREK hiç senkronlanmıyordu. `now_playing` ise
// yalnız TEK parçayı taşıyordu. Sonuç: kullanıcı Windows'ta Keşfet dinleyip
// Mac'i açınca kuyruk gelmiyor, uygulama sıfırdan yeni bir keşif kuruyordu
// (kullanıcının bildirdiği davranış).
//
// Bu tablo TÜM kuyruğu taşır: mod (keşif/normal), parçalar, index, pozisyon,
// filtreler ve tohum sanatçılar. Cihaz başına tek satır → çakışma yok
// (now_playing ile aynı desen).
//
// ⚠️ Yazım THROTTLE'lı: kuyruk JSON'u ~20 parça için birkaç KB; her şarkı
// değişiminde göndermek senkronu boğar.
// ═══════════════════════════════════════════════════════════════════════════

export interface RemoteQueue {
  deviceId: string;
  deviceName: string;
  mode: "discovery" | "normal";
  playlistId: string | null;
  queue: QueueItem[];
  queueIndex: number;
  positionMs: number;
  filters: string[];
  seeds: string[];
  updatedAt: number;
}

function deviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Mac/i.test(ua)) return "Mac";
  return "Device";
}

const WRITE_EVERY_MS = 20_000;
let lastWrite = 0;
let lastPayload = "";

export async function publishDeviceQueue(
  mode: "discovery" | "normal",
  queue: QueueItem[],
  queueIndex: number,
  positionMs: number,
  playlistId: string | null,
  filters: string[],
  seeds: string[],
  force = false
): Promise<void> {
  if (!isTauri() || queue.length === 0) return;
  const now = Date.now();
  const queueJson = JSON.stringify(queue);
  // Kuyruk değişmediyse yalnız index/pozisyon için sık sık yazma.
  if (!force && now - lastWrite < WRITE_EVERY_MS && queueJson === lastPayload) {
    return;
  }
  lastWrite = now;
  lastPayload = queueJson;
  try {
    const db = await getDb();
    await db.execute(
      `INSERT INTO device_queue
         (device_id, device_name, mode, playlist_id, queue_json, queue_index,
          position_ms, filters_json, seeds_json, updated_at, deleted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0)
       ON CONFLICT(device_id) DO UPDATE SET
         device_name = excluded.device_name, mode = excluded.mode,
         playlist_id = excluded.playlist_id, queue_json = excluded.queue_json,
         queue_index = excluded.queue_index, position_ms = excluded.position_ms,
         filters_json = excluded.filters_json, seeds_json = excluded.seeds_json,
         updated_at = excluded.updated_at, deleted = 0`,
      [
        getDeviceId(),
        deviceName(),
        mode,
        playlistId,
        queueJson,
        queueIndex,
        Math.floor(positionMs),
        JSON.stringify(filters),
        JSON.stringify(seeds),
        now,
      ]
    );
    notifyLocalChange();
  } catch (e) {
    console.error("[resonance] cihaz kuyruğu yazılamadı:", e);
  }
}

/**
 * BAŞKA bir cihazın en son kuyruğu (bu cihazınki hariç).
 * Bulutta tablo yoksa / senkron kapalıysa sessizce null döner.
 */
export async function latestRemoteQueue(): Promise<RemoteQueue | null> {
  if (!isTauri()) return null;
  try {
    const db = await getDb();
    const rows = await db.select<
      {
        device_id: string;
        device_name: string | null;
        mode: string | null;
        playlist_id: string | null;
        queue_json: string;
        queue_index: number;
        position_ms: number;
        filters_json: string | null;
        seeds_json: string | null;
        updated_at: number;
      }[]
    >(
      `SELECT device_id, device_name, mode, playlist_id, queue_json, queue_index,
              position_ms, filters_json, seeds_json, updated_at
         FROM device_queue
        WHERE deleted = 0 AND device_id <> $1 AND queue_json <> ''
        ORDER BY updated_at DESC LIMIT 1`,
      [getDeviceId()]
    );
    const r = rows[0];
    if (!r) return null;
    const queue = JSON.parse(r.queue_json) as QueueItem[];
    if (!Array.isArray(queue) || queue.length === 0) return null;
    return {
      deviceId: r.device_id,
      deviceName: r.device_name || "Device",
      mode: r.mode === "discovery" ? "discovery" : "normal",
      playlistId: r.playlist_id,
      queue,
      queueIndex: Math.min(Math.max(0, r.queue_index), queue.length - 1),
      positionMs: r.position_ms,
      filters: r.filters_json ? (JSON.parse(r.filters_json) as string[]) : [],
      seeds: r.seeds_json ? (JSON.parse(r.seeds_json) as string[]) : [],
      updatedAt: r.updated_at,
    };
  } catch (e) {
    console.warn("[resonance] uzak kuyruk okunamadı:", e);
    return null;
  }
}

/** Bu cihazın son yazdığı kuyruk zamanı (hangisi daha yeni karşılaştırması). */
export async function localQueueUpdatedAt(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    const db = await getDb();
    const rows = await db.select<{ updated_at: number }[]>(
      `SELECT updated_at FROM device_queue WHERE device_id = $1`,
      [getDeviceId()]
    );
    return rows[0]?.updated_at ?? 0;
  } catch {
    return 0;
  }
}
