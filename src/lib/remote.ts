import { getSupabase, getUserId } from "./sync/client";
import { getDeviceId } from "./device";
import { isTauri } from "./db";
import { usePlayerStore } from "../store/usePlayerStore";
import { useToastStore } from "../store/useToastStore";
import { voteCurrent } from "./vote";
import { t } from "./i18n";

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
  created_at: number;
}

let channelStarted = false;

async function apply(row: CommandRow): Promise<void> {
  const st = usePlayerStore.getState();
  switch (row.action as RemoteAction) {
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
  if (fresh.length > 0) {
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
      .select("id, target_device, action, value, created_at")
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
