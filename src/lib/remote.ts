import { getSupabase, getUserId } from "./sync/client";
import { getDeviceId } from "./device";
import { getDb, isTauri } from "./db";
import { DISCOVERY_ID, usePlayerStore } from "../store/usePlayerStore";
import { useToastStore } from "../store/useToastStore";
import { voteCurrent } from "./vote";
import { t } from "./i18n";
import type { QueueItem } from "../types";

function myDeviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac/i.test(ua)) return "Mac";
  return "Device";
}

export interface HandoffTarget {
  deviceId: string;
  name: string;
  lastSeen: number;
}

/**
 * Devredilebilecek cihazlar: senkronlanan `now_playing` satırlarından, son 14
 * günde görülenler; cihaz ADI başına en yeni kimlik (aynı makinenin eski
 * kimlikleri — bkz. v1.9.3 — gizlenir) ve bu makine hariç.
 */
export async function listHandoffTargets(): Promise<HandoffTarget[]> {
  if (!isTauri()) return [];
  const db = await getDb();
  const rows = await db.select<{ device_id: string; device_name: string | null; updated_at: number }[]>(
    `SELECT device_id, device_name, updated_at FROM now_playing
      WHERE deleted = 0 AND device_id <> $1 AND updated_at > $2
      ORDER BY updated_at DESC`,
    [getDeviceId(), Date.now() - 14 * 24 * 3600 * 1000]
  );
  const me = myDeviceName();
  const seen = new Set<string>();
  const out: HandoffTarget[] = [];
  for (const r of rows) {
    const name = r.device_name || "Device";
    if ((name === me && me !== "Device") || seen.has(name)) continue;
    seen.add(name);
    out.push({ deviceId: r.device_id, name, lastSeen: r.updated_at });
  }
  return out;
}

/** Çalanı (tüm kuyruk + saniye) hedef cihaza gönderir ve burada duraklatır. */
export async function sendHandoff(target: HandoffTarget): Promise<boolean> {
  const sb = getSupabase();
  const userId = await getUserId();
  const st = usePlayerStore.getState();
  if (!sb || !userId || !st.current || st.queue.length === 0) return false;
  const discovery = st.radioActive && st.radioPlaylistId === DISCOVERY_ID;
  const payload: HandoffPayload = {
    fromName: myDeviceName(),
    mode: discovery ? "discovery" : "normal",
    // Çok uzun kuyrukta komut şişmesin: çalandan itibaren 200 parça yeter.
    queue: st.queue.slice(st.queueIndex, st.queueIndex + 200),
    queueIndex: 0,
    positionMs: st.positionMs,
    filters: st.discoveryFilters,
    seeds: st.discoverySeedArtists,
  };
  const { error } = await sb.from(TABLE).insert({
    user_id: userId,
    id: crypto.randomUUID(),
    target_device: target.deviceId,
    action: "handoff",
    value: null,
    payload: JSON.stringify(payload),
    created_at: Date.now(),
  });
  if (error) {
    console.warn("[resonance] devretme gönderilemedi:", error.message);
    return false;
  }
  if (st.status === "playing") st.toggle();
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// UZAKTAN KUMANDA (v1.9.6) — "telefonum bilgisayardaki müziği yönetsin".
//
// Spotify Connect'in KUMANDA kısmı: ses hâlâ bu bilgisayarda çalar, komut
// telefondan gelir. (Sesi TV'ye/arabaya aktarmak AYRI bir iş — AirPlay/Cast
// protokolleri gerekir, bu uygulamanın ses yolu buna uygun değil.)
//
// Taşıyıcı: senkronun zaten kullandığı Supabase + Realtime. Komut `remote_commands`
// tablosuna YAZILIR, hedef cihaz kendi satırlarını dinler, uygular ve SİLER.
// Kalıcı kuyruk değil — uygulama kapalıyken gelen komut anlamsızdır, bu yüzden
// açılışta yalnız SON 60 saniyenin komutları işlenir.
//
// ⚠️ Cihaz durumu zaten `now_playing` ile yayılıyor → telefon ne çaldığını
// oradan okur; burada yalnız KOMUT yönü var.
// ═══════════════════════════════════════════════════════════════════════════

const TABLE = "remote_commands";
const MAX_AGE_MS = 60_000;

export type RemoteAction =
  | "handoff"
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "prev"
  | "seek"
  | "volume"
  | "vote";

interface CommandRow {
  id: string;
  target_device: string;
  action: string;
  value: number | null;
  /** "handoff" için JSON (bkz. HandoffPayload). */
  payload?: string | null;
  created_at: number;
}

/**
 * ⭐ DEVRETME (v1.9.8) — "telefonda çalanı tek dokunuşla bilgisayarda aynı
 * saniyeden sürdür" (ve tersi). Kuyruğun TAMAMI komutun içinde gider:
 * `now_playing`/`device_queue` senkronunu beklemek (8 sn debounce + çekme)
 * hem yavaş hem yarışlıydı — alıcı eski konumu okuyabilirdi.
 */
export interface HandoffPayload {
  fromName: string;
  mode: "discovery" | "normal";
  queue: QueueItem[];
  queueIndex: number;
  positionMs: number;
  filters: string[];
  seeds: string[];
}

function handoff(row: CommandRow): void {
  let p: HandoffPayload;
  try {
    p = JSON.parse(row.payload ?? "") as HandoffPayload;
  } catch {
    console.warn("[resonance] devretme komutu okunamadı");
    return;
  }
  if (!Array.isArray(p.queue) || p.queue.length === 0) return;
  const st = usePlayerStore.getState();
  if (p.mode === "discovery") {
    st.restoreDiscovery({
      queue: p.queue,
      queueIndex: p.queueIndex,
      seedArtists: p.seeds ?? [],
      filters: p.filters ?? [],
      positionMs: p.positionMs,
    });
  } else {
    st.restoreQueue(p.queue, p.queueIndex, p.positionMs);
  }
  // Kurulum duraklatılmış yapar; devretmenin anlamı "burada ÇALSIN".
  setTimeout(() => {
    if (usePlayerStore.getState().status !== "playing") usePlayerStore.getState().toggle();
  }, 50);
  useToastStore
    .getState()
    .show(t("remote.handoffReceived", { device: p.fromName || "?" }), "success");
}

let channelStarted = false;

async function apply(row: CommandRow): Promise<void> {
  const st = usePlayerStore.getState();
  switch (row.action as RemoteAction) {
    case "handoff":
      handoff(row);
      return;
    case "play":
      if (st.status !== "playing") st.toggle();
      break;
    case "pause":
      if (st.status === "playing") st.toggle();
      break;
    case "toggle":
      st.toggle();
      break;
    case "next":
      st.next("next");
      break;
    case "prev":
      st.prev();
      break;
    case "seek":
      if (typeof row.value === "number") st.seek(row.value);
      break;
    case "volume":
      if (typeof row.value === "number") st.setVolume(Math.min(1, Math.max(0, row.value)));
      break;
    case "vote":
      if (row.value === 1 || row.value === -1) await voteCurrent(row.value);
      break;
    default:
      console.warn("[resonance] bilinmeyen uzak komut:", row.action);
  }
}

async function consume(rows: CommandRow[], userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || rows.length === 0) return;
  const fresh = rows.filter((r) => Date.now() - Number(r.created_at ?? 0) < MAX_AGE_MS);
  for (const row of fresh) {
    try {
      await apply(row);
    } catch (e) {
      console.warn("[resonance] uzak komut uygulanamadı:", e);
    }
  }
  // İşlenen (ve eskiyen) satırları temizle — tablo birikmesin.
  await sb
    .from(TABLE)
    .delete()
    .eq("user_id", userId)
    .in("id", rows.map((r) => r.id))
    .then(undefined, () => {});
  // Devretmenin kendi bildirimi var; yalnız kumanda komutları için genel bildirim.
  if (fresh.some((r) => r.action !== "handoff")) {
    useToastStore.getState().show(t("remote.applied"), "info", undefined, 2500);
  }
}

/** Oturum açıkken çağrılır (senkronla birlikte). Tablo yoksa sessizce kapalı. */
export async function startRemoteControl(): Promise<void> {
  if (!isTauri() || channelStarted) return;
  const sb = getSupabase();
  const userId = await getUserId();
  if (!sb || !userId) return;
  const me = getDeviceId();

  // Uygulama kapalıyken gelmiş komutlar varsa (son 60 sn) onları da uygula.
  try {
    const { data, error } = await sb
      .from(TABLE)
      .select("id, target_device, action, value, payload, created_at")
      .eq("user_id", userId)
      .eq("target_device", me);
    if (error) return; // tablo yok → özellik kapalı
    await consume((data ?? []) as CommandRow[], userId);
  } catch {
    return;
  }

  channelStarted = true;
  sb.channel("resonance-remote")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: TABLE,
        filter: `target_device=eq.${me}`,
      },
      (payload) => {
        void consume([payload.new as CommandRow], userId);
      }
    )
    .subscribe();
  console.info("[resonance] uzaktan kumanda dinleniyor");
}
