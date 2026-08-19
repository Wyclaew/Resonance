import { getDb } from "./db";
import { getDeviceId } from "./device";
import { notifyLocalChange, SYNCED_SETTING_KEYS } from "./sync/engine";

// settings tablosu üzerinde basit anahtar-değer yardımcıları.
//
// ⭐ v1.8.0: tablo artık SEÇMELİ senkronlanıyor (beyaz liste:
// SYNCED_SETTING_KEYS, bkz. sync/engine.ts). Bu yüzden her yazım `updated_at`
// ve `device_id` doldurmak ZORUNDA — yoksa satır push penceresine hiç
// girmez ve ayar sessizce diğer cihaza geçmez.

export async function loadSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  // deleted = 0: senkron tombstone'ları (bkz. docs/SYNC.md).
  const rows = await db.select<{ key: string; value: string }[]>(
    `SELECT key, value FROM settings WHERE deleted = 0`
  );
  const o: Record<string, string> = {};
  for (const r of rows) o[r.key] = r.value;
  return o;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  // ⚠️ INSERT OR REPLACE değil, ON CONFLICT: OR REPLACE satırı silip yeniden
  // eklediği için senkron alanlarını da sıfırlardı.
  await db.execute(
    `INSERT INTO settings (key, value, updated_at, deleted, device_id)
     VALUES ($1, $2, $3, 0, $4)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value, updated_at = excluded.updated_at,
       deleted = 0, device_id = excluded.device_id`,
    [key, value, Date.now(), getDeviceId()]
  );
  // Yalnız senkronlanan bir ayarsa tur tetikle (yereller boşuna uyandırmasın).
  if (SYNCED_SETTING_KEYS.has(key)) notifyLocalChange();
}
