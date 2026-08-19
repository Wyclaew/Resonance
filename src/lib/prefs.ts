import { getDb, isTauri } from "./db";
import { getDeviceId } from "./device";
import { notifyLocalChange } from "./sync/engine";

// ═══════════════════════════════════════════════════════════════════════════
// SANATÇI AĞIRLIK TERCİHİ — "daha çok / daha az öner"
//
// NEDEN: modelin dört öğrenme katmanı da DOLAYLI. Kullanıcı bir sanatçıyı
// az görmek istiyorsa tek yolu ya oy vermek ya da tamamen engellemekti —
// arası yoktu. Bu tablo o arayı verir ve model hakkındaki kullanıcı kararını
// KALICI kılar (dinleme davranışı değişse bile geçerli kalır).
//
// ⚠️ SENKRONLANIR (blocked_artists ile aynı gerekçe): bu türetilmiş veri
// değil, bir KARAR. Anahtar sanatçı ADI olduğu için iki cihaz aynı sanatçıyı
// ayarlasa bile tek satırda birleşir; uid derdi yok.
//
// "Varsayılana dön" = tombstone (deleted = 1). Hard delete diğer cihazda eski
// ayarı geri getirirdi (bkz. docs/SYNC.md).
// ═══════════════════════════════════════════════════════════════════════════

/** Kullanıcının seçebildiği üç kademe. Çarpan olarak yakınlık puanına uygulanır. */
export const PREF_LESS = 0.35;
export const PREF_NORMAL = 1;
export const PREF_MORE = 2.2;

let cache = new Map<string, number>();
let loaded = false;

export async function loadArtistPrefs(force = false): Promise<Map<string, number>> {
  if (!isTauri()) return cache;
  if (loaded && !force) return cache;
  try {
    const db = await getDb();
    const rows = await db.select<{ artist: string; weight: number }[]>(
      `SELECT artist, weight FROM artist_prefs WHERE deleted = 0`
    );
    cache = new Map(rows.map((r) => [r.artist, r.weight]));
    loaded = true;
  } catch (e) {
    console.error("[resonance] sanatçı tercihleri okunamadı:", e);
  }
  return cache;
}

/** Tohum ağırlığı çarpanı. Ayarlanmamışsa 1 (etkisiz). */
export function prefWeight(artist: string): number {
  return cache.get(artist.trim().toLowerCase()) ?? PREF_NORMAL;
}

/** UI: elle ayarlanmış sanatçılar. */
export function listArtistPrefs(): { artist: string; weight: number }[] {
  return [...cache.entries()].map(([artist, weight]) => ({ artist, weight }));
}

export async function setArtistPref(artist: string, weight: number): Promise<void> {
  const key = artist.trim().toLowerCase();
  if (!key || !isTauri()) return;
  try {
    const db = await getDb();
    const now = Date.now();
    if (weight === PREF_NORMAL) {
      // Varsayılana dönüş — satırı tombstone'la (senkronda da varsayılana dönsün).
      await db.execute(
        `UPDATE artist_prefs SET deleted = 1, weight = 1, updated_at = $1 WHERE artist = $2`,
        [now, key]
      );
      cache.delete(key);
    } else {
      await db.execute(
        `INSERT INTO artist_prefs (artist, weight, created_at, updated_at, deleted, device_id)
         VALUES ($1, $2, $3, $3, 0, $4)
         ON CONFLICT(artist) DO UPDATE SET
           weight = excluded.weight, deleted = 0,
           updated_at = excluded.updated_at, device_id = excluded.device_id`,
        [key, weight, now, getDeviceId()]
      );
      cache.set(key, weight);
    }
    notifyLocalChange();
  } catch (e) {
    console.error("[resonance] sanatçı tercihi yazılamadı:", e);
  }
}
