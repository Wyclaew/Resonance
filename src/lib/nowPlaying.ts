import type { Track } from "../types";
import { getDb, isTauri } from "./db";
import { getDeviceId } from "./device";
import { notifyLocalChange } from "./sync/engine";

// ═══════════════════════════════════════════════════════════════════════════
// CİHAZLAR ARASI "KALDIĞIN YERDEN DEVAM"
//
// Her cihaz `now_playing` tablosunda KENDİ satırını tutar (anahtar device_id).
// Bu tablo senkronlanır → Windows'ta bıraktığın şarkıyı Mac (ve ileride
// telefon) görür ve aynı saniyeden devam edebilirsin.
//
// ⚠️ Neden `settings.resumeState` DEĞİL: settings bilerek senkronlanmıyor
// (içinde cihaz kimliği, ses seviyesi, Keşfet kuyruğu var — cihaza özel).
//
// ⚠️ Neden cihaz başına satır: tek ortak "son çalan" satırı olsaydı iki cihaz
// aynı anda çalarken birbirini sürekli ezerdi. Cihaz başına satırda çakışma
// yapısı gereği yok.
// ═══════════════════════════════════════════════════════════════════════════

export interface DevicePlayback {
  deviceId: string;
  deviceName: string;
  trackId: string;
  sourceId: string;
  title: string;
  artist: string;
  thumbnail?: string;
  durationMs: number;
  positionMs: number;
  playing: boolean;
  updatedAt: number;
}

/** Kaba cihaz adı — kullanıcı "hangi cihazda bıraktım"ı okusun diye. */
function deviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  // Not: bu ad SENKRONLANIR ve diğer cihazda olduğu gibi gösterilir → dile
  // bağlı olmamalı. Platform adları zaten özel isim (Windows/Mac/Android).
  return "Device";
}

// Yazma sıklığı: her tick'te yazmak DB'yi ve senkronu boğar. 15 sn yeterli —
// cihaz değiştirirken saniyelik hassasiyet gerekmiyor.
const WRITE_EVERY_MS = 15_000;
let lastWrite = 0;

/** Bu cihazın "şu an çalıyor" durumunu yazar (throttle'lı). */
export async function publishNowPlaying(
  track: Track | null,
  positionMs: number,
  playing: boolean,
  force = false
): Promise<void> {
  if (!isTauri()) return;
  const now = Date.now();
  if (!force && now - lastWrite < WRITE_EVERY_MS) return;
  lastWrite = now;
  try {
    const db = await getDb();
    if (!track) {
      // Çalmıyor → satırı tombstone'la (diğer cihazda "devam et" çıkmasın).
      await db.execute(
        `UPDATE now_playing SET deleted = 1, updated_at = $1 WHERE device_id = $2`,
        [now, getDeviceId()]
      );
    } else {
      await db.execute(
        `INSERT INTO now_playing
           (device_id, device_name, track_id, source_id, title, artist,
            thumbnail, duration_ms, position_ms, playing, updated_at, deleted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0)
         ON CONFLICT(device_id) DO UPDATE SET
           device_name=excluded.device_name, track_id=excluded.track_id,
           source_id=excluded.source_id, title=excluded.title,
           artist=excluded.artist, thumbnail=excluded.thumbnail,
           duration_ms=excluded.duration_ms, position_ms=excluded.position_ms,
           playing=excluded.playing, updated_at=excluded.updated_at, deleted=0`,
        [
          getDeviceId(),
          deviceName(),
          track.id,
          track.sourceId,
          track.title,
          track.artist,
          track.thumbnail ?? null,
          track.durationMs,
          Math.floor(positionMs),
          playing ? 1 : 0,
          now,
        ]
      );
    }
    notifyLocalChange();
  } catch (e) {
    console.error("[resonance] now_playing yazılamadı:", e);
  }
}

/**
 * BAŞKA cihazlarda yakın zamanda bırakılan çalma durumu.
 * @param maxAgeMs Bundan eski satırlar gösterilmez (varsayılan 24 saat).
 */
export async function otherDevicePlayback(
  maxAgeMs = 24 * 3600 * 1000
): Promise<DevicePlayback | null> {
  if (!isTauri()) return null;
  try {
    const db = await getDb();
    const rows = await db.select<
      {
        device_id: string;
        device_name: string | null;
        track_id: string;
        source_id: string;
        title: string;
        artist: string;
        thumbnail: string | null;
        duration_ms: number;
        position_ms: number;
        playing: number;
        updated_at: number;
      }[]
    >(
      `SELECT * FROM now_playing
       WHERE device_id <> $1 AND deleted = 0 AND track_id IS NOT NULL
         AND updated_at > $2
       ORDER BY updated_at DESC LIMIT 1`,
      [getDeviceId(), Date.now() - maxAgeMs]
    );
    const r = rows[0];
    if (!r) return null;
    // Şarkının sonuna gelmişse "devam et" anlamsız.
    if (r.duration_ms > 0 && r.position_ms > r.duration_ms - 15_000) return null;
    return {
      deviceId: r.device_id,
      deviceName: r.device_name ?? "?",
      trackId: r.track_id,
      sourceId: r.source_id,
      title: r.title,
      artist: r.artist,
      thumbnail: r.thumbnail ?? undefined,
      durationMs: r.duration_ms,
      positionMs: r.position_ms,
      playing: r.playing === 1,
      updatedAt: r.updated_at,
    };
  } catch (e) {
    console.error("[resonance] now_playing okunamadı:", e);
    return null;
  }
}
