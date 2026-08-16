import { getDb, isTauri } from "./db";
import { getDeviceId } from "./device";
import { notifyLocalChange } from "./sync/engine";

// ═══════════════════════════════════════════════════════════════════════════
// "BU SANATÇIYI ÖNERME" — açık olumsuz sinyal
//
// Eskiden olumsuz geri bildirim yalnız DOLAYLIYDI: geçersen yakınlık düşerdi.
// Ama yeterince güçlü sinyali olan (ör. listende duran) bir sanatçı, radyodan
// gelmesini istemesen bile dönüp duruyordu. Kabul oranı (acceptance.ts) bunu
// zamanla yumuşatır ama "bir daha görmek istemiyorum" demenin YOLU YOKTU.
//
// ⚠️ Anahtar = sanatçı ADI (küçük harf) → cihazdan bağımsız, senkronda tek
// satırda birleşir. Silme tombstone (deleted=1) — engeli kaldırınca da
// diğer cihaza gider.
// ═══════════════════════════════════════════════════════════════════════════

let cache = new Set<string>();
let loaded = false;

export async function loadBlockedArtists(force = false): Promise<Set<string>> {
  if (!isTauri()) return cache;
  if (loaded && !force) return cache;
  try {
    const db = await getDb();
    const rows = await db.select<{ artist: string }[]>(
      `SELECT artist FROM blocked_artists WHERE deleted = 0`
    );
    cache = new Set(rows.map((r) => r.artist));
    loaded = true;
  } catch (e) {
    console.error("[resonance] engellenen sanatçılar okunamadı:", e);
  }
  return cache;
}

export function isBlocked(artist: string): boolean {
  return cache.has(artist.trim().toLowerCase());
}

export function blockedArtists(): string[] {
  return [...cache];
}

export async function blockArtist(artist: string): Promise<void> {
  const key = artist.trim().toLowerCase();
  if (!key || !isTauri()) return;
  try {
    const db = await getDb();
    const now = Date.now();
    await db.execute(
      `INSERT INTO blocked_artists (artist, created_at, updated_at, deleted, device_id)
       VALUES ($1, $2, $2, 0, $3)
       ON CONFLICT(artist) DO UPDATE SET
         deleted = 0, updated_at = excluded.updated_at, device_id = excluded.device_id`,
      [key, now, getDeviceId()]
    );
    cache.add(key);
    notifyLocalChange();
  } catch (e) {
    console.error("[resonance] sanatçı engellenemedi:", e);
  }
}

export async function unblockArtist(artist: string): Promise<void> {
  const key = artist.trim().toLowerCase();
  if (!key || !isTauri()) return;
  try {
    const db = await getDb();
    // Tombstone — hard delete diğer cihazda engeli geri getirirdi.
    await db.execute(
      `UPDATE blocked_artists SET deleted = 1, updated_at = $1 WHERE artist = $2`,
      [Date.now(), key]
    );
    cache.delete(key);
    notifyLocalChange();
  } catch (e) {
    console.error("[resonance] engel kaldırılamadı:", e);
  }
}
