import { buildBackupJson } from "./backupExport";
import { importBackup, type ImportResult } from "./backup";
import { getSupabase, getUserId } from "./sync/client";
import { getDeviceId, newUid } from "./device";
import { loadSettings, setSetting } from "./settings";
import { isTauri } from "./db";

// ═══════════════════════════════════════════════════════════════════════════
// BULUTA OTOMATİK YEDEK (v1.9.5)
//
// ⛔ NEDEN: yedekler yalnız uygulamanın kendi klasöründeydi (`backups/`).
// 2026-09-15'te o klasör (uygulama verisiyle birlikte) silindi — 12 yedeğin
// HEPSİ gitti. Yerel yedek, "uygulama verisi kayboldu" senaryosunda hiçbir işe
// yaramıyor; yedeğin BAŞKA BİR YERDE olması gerekiyor.
//
// Nerede: senkronun zaten kullandığı Supabase'te ayrı bir tablo
// (`cloud_backups`, RLS ile yalnız kendi satırların). Ayrı bir depolama
// kovası kurmak gerekmesin diye JSON metin olarak yazılır (birkaç yüz KB).
// ⚠️ Bu tablo SENKRON TABLOLARINDAN DEĞİL: `TABLES` listesine EKLEME —
// yedekler cihazlar arasında birleştirilmez, olduğu gibi durur.
// ═══════════════════════════════════════════════════════════════════════════

const TABLE = "cloud_backups";
const KEEP = 5;
const EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_KEY = "backup.lastCloud";
/** Yedek buradan büyükse yazma (bir hata olmuş olabilir; boş yere şişirmeyelim). */
const MAX_BYTES = 12 * 1024 * 1024;

export interface CloudBackup {
  id: string;
  createdAt: number;
  device: string;
  bytes: number;
  tracks: number;
  playlists: number;
}

function deviceLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac/i.test(ua)) return "Mac";
  return "Device";
}

export async function createCloudBackup(): Promise<CloudBackup | null> {
  const sb = getSupabase();
  const userId = await getUserId();
  if (!sb || !userId) return null;

  const payload = await buildBackupJson();
  const bytes = new TextEncoder().encode(payload).length;
  if (bytes > MAX_BYTES) throw new Error(`yedek çok büyük (${bytes} B)`);
  const parsed = JSON.parse(payload) as {
    tracks?: unknown[];
    playlists?: unknown[];
  };
  const row = {
    user_id: userId,
    id: newUid(),
    created_at: Date.now(),
    device_id: getDeviceId(),
    device_name: deviceLabel(),
    bytes,
    tracks: parsed.tracks?.length ?? 0,
    playlists: parsed.playlists?.length ?? 0,
    payload,
  };
  const { error } = await sb.from(TABLE).insert(row);
  if (error) throw new Error(error.message);
  await setSetting(LAST_KEY, String(Date.now())).catch(() => {});

  // Son KEEP tanesini tut (eski yedekler buluta yığılmasın).
  try {
    const all = await listCloudBackups();
    const extra = all.slice(KEEP);
    if (extra.length > 0) {
      await sb
        .from(TABLE)
        .delete()
        .eq("user_id", userId)
        .in("id", extra.map((b) => b.id));
    }
  } catch {
    /* budama başarısızsa sorun değil */
  }
  console.warn(`[resonance] buluta yedek yazıldı (${bytes} B)`);
  return {
    id: row.id,
    createdAt: row.created_at,
    device: row.device_name,
    bytes,
    tracks: row.tracks,
    playlists: row.playlists,
  };
}

/** Yeniden eskiye. Yük (payload) ÇEKİLMEZ — liste hafif kalsın. */
export async function listCloudBackups(): Promise<CloudBackup[]> {
  const sb = getSupabase();
  const userId = await getUserId();
  if (!sb || !userId) return [];
  const { data, error } = await sb
    .from(TABLE)
    .select("id, created_at, device_name, bytes, tracks, playlists")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    createdAt: Number(r.created_at ?? 0),
    device: String(r.device_name ?? "?"),
    bytes: Number(r.bytes ?? 0),
    tracks: Number(r.tracks ?? 0),
    playlists: Number(r.playlists ?? 0),
  }));
}

/** Yedeği İÇE AKTARIR (birleştirir, silmez — `importBackup` ile aynı kural). */
export async function restoreCloudBackup(id: string): Promise<ImportResult> {
  const sb = getSupabase();
  const userId = await getUserId();
  if (!sb || !userId) throw new Error("oturum yok");
  const { data, error } = await sb
    .from(TABLE)
    .select("payload")
    .eq("user_id", userId)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const payload = (data as { payload?: string } | null)?.payload;
  if (!payload) throw new Error("yedek boş");
  return importBackup(payload);
}

/** Açılışta çağrılır: haftada bir, sessizce. */
export async function maybeWeeklyCloudBackup(): Promise<void> {
  if (!isTauri()) return;
  try {
    const last = Number((await loadSettings())[LAST_KEY] ?? 0);
    if (Number.isFinite(last) && Date.now() - last < EVERY_MS) return;
    await createCloudBackup();
  } catch (e) {
    console.warn("[resonance] buluta yedek yazılamadı:", e);
  }
}
