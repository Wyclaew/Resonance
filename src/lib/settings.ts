import { getDb } from "./db";

// settings tablosu üzerinde basit anahtar-değer yardımcıları.

export async function loadSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    `SELECT key, value FROM settings`
  );
  const o: Record<string, string> = {};
  for (const r of rows) o[r.key] = r.value;
  return o;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)`,
    [key, value]
  );
}
