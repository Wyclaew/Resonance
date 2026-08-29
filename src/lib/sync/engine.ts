import type { RealtimeChannel } from "@supabase/supabase-js";
import { getDb, isTauri } from "../db";
import { getSupabase, getUserId } from "./client";
import { isSyncConfigured } from "./config";

// ═══════════════════════════════════════════════════════════════════════════
// Resonance senkron motoru — local-first, delta sync, last-write-wins.
//
// TEMEL FİKİR: her cihaz kendi SQLite'ını kaynak olarak kullanır (çevrimdışı
// tam çalışır). Motor yalnızca DEĞİŞENLERİ taşır:
//   • push : yerelde `updated_at > last_pushed` olan satırlar → buluta upsert
//   • pull : bulutta `synced_at > last_pulled` olan satırlar → yerele LWW merge
//
// ⭐ İKİ FARKLI ZAMAN DAMGASI — bu ayrım kritik, karıştırma:
//   • `updated_at` (epoch ms, CİHAZ saati) → yalnız ÇAKIŞMA ÇÖZÜMÜ (LWW).
//   • `synced_at`  (timestamptz, SUNUCU saati) → yalnız TESLİMAT penceresi.
//   Neden: iki cihazın saati birbirini tutmaz. Teslimat penceresi cihaz
//   saatine bağlansaydı, saati geri kalan cihaz diğerinin satırlarını
//   "zaten görmüşüm" sanıp SONSUZA DEK ATLARDI. Sunucu saati tek ve ortaktır.
//
// ⭐ SİLME = TOMBSTONE. Hard delete diğer cihaza "böyle bir satır hiç yoktu"
//   gibi görünür ve satır geri gelir. Bu yüzden `deleted = 1` yazılır ve tüm
//   okumalar `deleted = 0` filtreler (bkz. playlists.ts).
//
// SENKRONLANMAYANLAR (bilerek):
//   • `cache` → indirilen ses dosyaları cihaza özel (yolu ve varlığı farklı).
//   • `settings` → içinde `resumeState` (Keşfet kuyruğu), cihaz kimliği, ses
//     seviyesi gibi CİHAZA ÖZEL şeyler var; senkronlamak zarar verir.
// ═══════════════════════════════════════════════════════════════════════════

type TableSpec = {
  name: string;
  /** Yerel ON CONFLICT hedefi (SQLite). */
  conflict: string;
  /** Buluttaki benzersizlik hedefi (user_id dahil). */
  cloudConflict: string;
  /** Senkronlanan sütunlar (yerel = bulut isimleri birebir aynı). */
  cols: string[];
  /**
   * Yalnız belirli satırları taşı (settings için ŞART: tablonun tamamı değil,
   * beyaz listedeki anahtarlar senkronlanır). Push'ta SQL koşulu, pull'da aynı
   * kararı veren JS süzgeci — İKİSİ DE olmalı, yoksa bulutta duran cihaza özel
   * bir satır geri sızar.
   */
  pushWhere?: string;
  pullKeep?: (row: Record<string, unknown>) => boolean;
};

// ⭐ SENKRONLANAN AYARLAR (v1.8.0) — beyaz liste, kara liste DEĞİL.
// Yeni bir ayar eklendiğinde varsayılan davranış "senkronlanmaz" olmalı:
// cihaza özel bir ayarı yanlışlıkla senkronlamak (ör. ses seviyesi, avatar,
// cihaz kimliği) sessiz ve can sıkıcı hatalar üretir.
export const SYNCED_SETTING_KEYS = new Set([
  "appearance.theme",
  "appearance.language",
  "appearance.accent",
  "appearance.screensaverSeconds",
  "rec.enabled",
  "rec.source.youtube",
  "rec.source.library",
  "rec.everyN",
  "karma.halfLifeDays",
  "storage.audioQuality",
  "storage.cacheLimitGb",
  "storage.autoDownloadTop",
  "playback.prefetch",
  "playback.normalizeVolume",
  "playback.crossfadeSeconds",
  "playback.queueEndBehavior",
  "playback.sleepFadeSeconds",
]);
// ⛔ BİLEREK DIŞARIDA: playback.resumeState (cihazın kendi kuyruğu —
// device_queue tablosu taşır), playback.savedVolume / rememberVolume,
// profile.avatarDataUrl, yt.cookiesBrowser (tarayıcı cihaza göre değişir),
// spotify.clientId/Secret (gizli anahtar buluta düz metin gitmesin),
// app.onboardingDone (yeni cihazda rehber görünsün), mini.geometry (mini
// oynatıcının konumu — ekran düzeni cihaza göre değişir).
const SETTINGS_WHERE = `key IN (${[...SYNCED_SETTING_KEYS]
  .map((k) => `'${k}'`)
  .join(", ")})`;

// ⚠️ SIRA ÖNEMLİ — yabancı anahtar bağımlılığı:
// playlist_tracks → playlists(id) ve tracks(id). Ebeveynler önce gelmeli,
// yoksa pull sırasında FK ihlali olur (SQLite'ta FK açık: sqlx varsayılanı).
const TABLES: TableSpec[] = [
  {
    name: "tracks",
    conflict: "id",
    cloudConflict: "user_id,id",
    cols: [
      "id", "source", "source_id", "title", "artist", "album",
      "duration_ms", "thumbnail", "added_at", "updated_at",
    ],
  },
  {
    name: "playlists",
    conflict: "id",
    cloudConflict: "user_id,id",
    cols: [
      "id", "name", "description", "source", "source_url",
      "created_at", "updated_at", "deleted",
    ],
  },
  {
    name: "playlist_tracks",
    conflict: "playlist_id, track_id",
    cloudConflict: "user_id,playlist_id,track_id",
    cols: [
      "playlist_id", "track_id", "position", "added_at", "vote",
      "updated_at", "deleted",
    ],
  },
  {
    name: "votes",
    conflict: "uid",
    cloudConflict: "user_id,uid",
    cols: [
      "uid", "track_id", "playlist_id", "value", "created_at",
      "hour", "dow", "device_id", "updated_at", "deleted",
    ],
  },
  {
    name: "play_history",
    conflict: "uid",
    cloudConflict: "user_id,uid",
    cols: [
      "uid", "track_id", "played_at", "ms_played", "hour", "dow",
      "device_id", "updated_at",
    ],
  },
  {
    // Cihazlar arası "kaldığın yerden devam": her cihaz KENDİ satırını yazar
    // (anahtar device_id) → çakışma yok.
    name: "now_playing",
    conflict: "device_id",
    cloudConflict: "user_id,device_id",
    cols: [
      "device_id", "device_name", "track_id", "source_id", "title", "artist",
      "thumbnail", "duration_ms", "position_ms", "playing", "updated_at",
      "deleted",
    ],
  },
  {
    // "Bu sanatçıyı önerme" — anahtar sanatçı ADI (cihazdan bağımsız) →
    // iki cihaz aynı sanatçıyı engellese tek satırda birleşir.
    name: "blocked_artists",
    conflict: "artist",
    cloudConflict: "user_id,artist",
    cols: ["artist", "created_at", "updated_at", "deleted", "device_id"],
  },
  {
    // "Daha çok / daha az öner" — kullanıcının ELLE kararı. Türetilmiş veri
    // değil, bu yüzden senkronlanır (blocked_artists ile aynı gerekçe).
    name: "artist_prefs",
    conflict: "artist",
    cloudConflict: "user_id,artist",
    cols: ["artist", "weight", "created_at", "updated_at", "deleted", "device_id"],
  },
  {
    // Seçmeli ayar senkronu — yalnız beyaz listedeki anahtarlar.
    name: "settings",
    conflict: "key",
    cloudConflict: "user_id,key",
    cols: ["key", "value", "updated_at", "deleted", "device_id"],
    pushWhere: SETTINGS_WHERE,
    pullKeep: (r) => SYNCED_SETTING_KEYS.has(String(r.key ?? "")),
  },
  {
    // Cihazlar arası KUYRUK (Keşfet partisi dahil). Cihaz başına satır.
    name: "device_queue",
    conflict: "device_id",
    cloudConflict: "user_id,device_id",
    cols: [
      "device_id", "device_name", "mode", "playlist_id", "queue_json",
      "queue_index", "position_ms", "filters_json", "seeds_json",
      "updated_at", "deleted",
    ],
  },
  {
    name: "recommendation_history",
    conflict: "uid",
    cloudConflict: "user_id,uid",
    cols: ["uid", "track_id", "recommended_at", "device_id", "updated_at"],
  },
];

// Bulutta NULL gelirse 0'a çekilecek sayısal NOT NULL sütunlar (şema uyumu).
const NUM_DEFAULT_0 = new Set([
  "updated_at", "deleted", "position", "vote", "duration_ms", "ms_played",
  "value", "hour", "dow", "added_at", "created_at", "played_at",
  "recommended_at", "position_ms", "playing", "queue_index",
]);

// Varsayılanı 0 OLMAYAN sayısal sütunlar. `artist_prefs.weight` yerelde
// NOT NULL DEFAULT 1: NULL yazılsaydı satır hiç uygulanamaz, pull su terazisi
// o satırda takılır ve her turda aynı hatayı tekrarlardı.
const NUM_DEFAULT_1 = new Set(["weight"]);

const PAGE = 500; // pull sayfa boyutu
const CHUNK = 400; // push yığın boyutu
const EPOCH0 = "1970-01-01T00:00:00Z";

// ── Durum & dinleyiciler ───────────────────────────────────────────────────

export type SyncStatus = "idle" | "syncing" | "error" | "off";

export type SyncState = {
  status: SyncStatus;
  lastSyncAt: number | null;
  lastError: string | null;
  pushed: number;
  pulled: number;
};

let state: SyncState = {
  status: "off",
  lastSyncAt: null,
  lastError: null,
  pushed: 0,
  pulled: 0,
};

type Listener = (s: SyncState) => void;
const listeners = new Set<Listener>();

export function subscribeSync(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export function getSyncState(): SyncState {
  return state;
}

// ── Su terazisi (watermark) defteri ────────────────────────────────────────

async function readWatermarks(table: string) {
  const db = await getDb();
  const rows = await db.select<{ last_pulled: string; last_pushed: number }[]>(
    `SELECT last_pulled, last_pushed FROM sync_state WHERE table_name = $1`,
    [table]
  );
  return {
    lastPulled: rows[0]?.last_pulled || "",
    lastPushed: rows[0]?.last_pushed ?? 0,
  };
}

async function writeWatermark(
  table: string,
  patch: { lastPulled?: string; lastPushed?: number }
) {
  const db = await getDb();
  const cur = await readWatermarks(table);
  await db.execute(
    `INSERT INTO sync_state (table_name, last_pulled, last_pushed)
     VALUES ($1, $2, $3)
     ON CONFLICT(table_name) DO UPDATE SET
       last_pulled = excluded.last_pulled, last_pushed = excluded.last_pushed`,
    [
      table,
      patch.lastPulled ?? cur.lastPulled,
      patch.lastPushed ?? cur.lastPushed,
    ]
  );
}

/**
 * En son ne zaman senkron oldu (epoch ms)? Hiç olmadıysa 0.
 *
 * ⚠️ NEDEN: oturum jetonu süresi dolduğunda ya da uygulama çevrimdışı
 * açıldığında senkron SESSİZCE duruyor. Kullanıcı hâlâ senkronlandığını
 * sanıyor ve "diğer cihazdaki değişiklikler neden gelmiyor" diyor. Bu değere
 * bakıp uzun süredir tur atılmadıysa uyarabiliyoruz — auth iç durumuna
 * güvenmek yerine GÖZLENEBİLİR sonucu ölçüyoruz.
 */
export async function lastSyncAt(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    const db = await getDb();
    const rows = await db.select<{ m: number | null }[]>(
      `SELECT MAX(last_pushed) AS m FROM sync_state`
    );
    return rows[0]?.m ?? 0;
  } catch {
    return 0;
  }
}

/** Bu cihaz daha önce hiç senkron oldu mu? (ilk-senkron sihirbazı için) */
export async function hasSyncedBefore(): Promise<boolean> {
  if (!isTauri()) return false;
  const db = await getDb();
  const rows = await db.select<{ c: number }[]>(
    `SELECT COUNT(*) AS c FROM sync_state
     WHERE last_pulled <> '' OR last_pushed > 0`
  );
  return (rows[0]?.c ?? 0) > 0;
}

// ── Yerele yazma (LWW merge) ───────────────────────────────────────────────

// `WHERE excluded.updated_at > tablo.updated_at` → LAST-WRITE-WINS.
// Eski bir satır geç ulaşsa bile yeniyi EZEMEZ.
function upsertSql(spec: TableSpec): string {
  const ph = spec.cols.map((_, i) => `$${i + 1}`).join(", ");
  const conflictCols = spec.conflict.split(",").map((s) => s.trim());
  const sets = spec.cols
    .filter((c) => !conflictCols.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  return `INSERT INTO ${spec.name} (${spec.cols.join(", ")}) VALUES (${ph})
          ON CONFLICT(${spec.conflict}) DO UPDATE SET ${sets}
          WHERE excluded.updated_at > ${spec.name}.updated_at`;
}

function valuesFor(spec: TableSpec, row: Record<string, unknown>): unknown[] {
  return spec.cols.map((c) => {
    const v = row[c];
    if (v === undefined || v === null) {
      if (NUM_DEFAULT_0.has(c)) return 0;
      if (NUM_DEFAULT_1.has(c)) return 1;
      return null;
    }
    return v;
  });
}

// ── Pull ───────────────────────────────────────────────────────────────────

async function pullTable(spec: TableSpec, userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const db = await getDb();
  const sql = upsertSql(spec);

  const { lastPulled } = await readWatermarks(spec.name);
  let since = lastPulled || EPOCH0;
  let applied = 0;

  for (;;) {
    const { data, error } = await sb
      .from(spec.name)
      .select("*")
      .eq("user_id", userId)
      .gt("synced_at", since)
      .order("synced_at", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`${spec.name} pull: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;

    // Satırlar synced_at SIRALI işlenir. Bir satır hata verirse (tipik olarak
    // ebeveyni henüz gelmemiş bir FK ihlali) su terazisi O SATIRDAN ÖNCEYE
    // sabitlenir → sonraki turda yeniden denenir ve KAYBOLMAZ. Kalan satırlar
    // yine uygulanır (idempotent; tekrar gelmeleri zararsız).
    let safeWatermark: string | null = null;
    let stopAdvancing = false;

    for (const row of rows as Record<string, unknown>[]) {
      try {
        // Beyaz liste dışı satırı yerele YAZMA (bulutta eski bir sürümden
        // kalmış olabilir); yine de su terazisi ilerlesin, yoksa takılırdı.
        if (spec.pullKeep && !spec.pullKeep(row)) {
          if (!stopAdvancing) safeWatermark = String(row.synced_at);
          continue;
        }
        await db.execute(sql, valuesFor(spec, row));
        applied++;
        if (!stopAdvancing) safeWatermark = String(row.synced_at);
      } catch (e) {
        console.error(`[sync] ${spec.name} satırı uygulanamadı:`, e);
        stopAdvancing = true;
      }
    }

    const lastRow = rows[rows.length - 1] as Record<string, unknown>;
    const next = stopAdvancing
      ? safeWatermark
      : String(lastRow.synced_at ?? safeWatermark);
    if (!next || next === since) break; // ilerleme yok → sonsuz döngüyü kes
    since = next;
    await writeWatermark(spec.name, { lastPulled: since });
    if (rows.length < PAGE || stopAdvancing) break;
  }

  return applied;
}

// ── Push ───────────────────────────────────────────────────────────────────

async function pushTable(spec: TableSpec, userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const db = await getDb();
  const { lastPushed } = await readWatermarks(spec.name);

  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT ${spec.cols.join(", ")} FROM ${spec.name}
     WHERE updated_at > $1${spec.pushWhere ? ` AND ${spec.pushWhere}` : ""}
     ORDER BY updated_at ASC`,
    [lastPushed]
  );
  if (rows.length === 0) return 0;

  let maxUpdated = lastPushed;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk: Record<string, unknown>[] = rows
      .slice(i, i + CHUNK)
      .map((r) => ({ ...r, user_id: userId }));
    const { error } = await sb
      .from(spec.name)
      .upsert(chunk, { onConflict: spec.cloudConflict });
    if (error) throw new Error(`${spec.name} push: ${error.message}`);
    for (const r of chunk) {
      const u = Number(r.updated_at ?? 0);
      if (u > maxUpdated) maxUpdated = u;
    }
    // Yığın başına yaz: yarıda kesilirse baştan başlamayalım.
    await writeWatermark(spec.name, { lastPushed: maxUpdated });
  }
  return rows.length;
}

// ── Tam bir senkron turu ───────────────────────────────────────────────────

let running = false;
let rerunRequested = false;

/**
 * @param mode "full" (varsayılan) | "push" | "pull"
 *
 * ⭐ NEDEN AYRIM VAR (v1.8.0): her yerel değişiklik (her çalınan şarkı bile
 * play_history yazar) TAM tur tetikliyordu. Push tarafı ucuz — değişmemiş
 * tablo hiç ağ isteği yapmaz — ama PULL her tablo için mutlaka bir istek
 * atar: şarkı başına 10+ gereksiz istek. Kullanıcı "sürekli senkronlayıp
 * duruyor" diye bildirdi. Artık yerel değişiklik yalnız PUSH eder; pull
 * realtime bildirimi, periyodik tur ve pencere odağıyla gelir.
 */
export async function syncNow(mode: "full" | "push" | "pull" = "full"): Promise<void> {
  if (!isTauri() || !isSyncConfigured()) return;
  const userId = await getUserId();
  if (!userId) {
    setState({ status: "off" });
    return;
  }
  if (running) {
    // Tur sürerken gelen istekler tek bir ek tura toplanır.
    rerunRequested = true;
    return;
  }
  running = true;
  setState({ status: "syncing", lastError: null });

  try {
    let pushed = 0;
    let pulled = 0;
    const errors: string[] = [];

    // ⭐ TABLO BAŞINA HATA YALITIMI. Eskiden döngü doğrudan `await` ediyordu:
    // TEK bir tablonun hatası (ör. bulutta o tablo yok) tüm turu iptal
    // ediyordu — sonraki push'lar VE BÜTÜN PULL'LAR hiç çalışmıyordu.
    // Gerçekte yaşandı: `now_playing` bulutta olmayınca senkron komple durdu.
    // Artık bir tablo patlasa da diğerleri taşınır; hata toplanıp bildirilir.
    const guard = async (label: string, fn: () => Promise<number>) => {
      try {
        return await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[sync] ${label} başarısız:`, e);
        errors.push(msg);
        return 0;
      }
    };

    // ÖNCE PUSH: yereldeki değişiklik buluta çıkmadan pull edilirse, gelen
    // eski satır LWW'de kaybeder ama gereksiz iş olur. Push→pull daha temiz.
    if (mode !== "pull") {
      for (const spec of TABLES) {
        pushed += await guard(`${spec.name} push`, () => pushTable(spec, userId));
      }
    }
    if (mode !== "push") {
      for (const spec of TABLES) {
        pulled += await guard(`${spec.name} pull`, () => pullTable(spec, userId));
      }
    }

    setState({
      status: errors.length > 0 ? "error" : "idle",
      lastSyncAt: Date.now(),
      pushed,
      pulled,
      lastError: errors.length > 0 ? describeSyncError(errors) : null,
    });
    if (pulled > 0) notifyRemoteApplied();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync] tur başarısız:", e);
    setState({ status: "error", lastError: msg });
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      void syncNow();
    }
  }
}

/**
 * Hata mesajlarını kullanıcının ANLAYACAĞI bir cümleye çevirir.
 *
 * En sık karşılaşılan: sunucu şeması eski (uygulama yeni bir tablo ekledi ama
 * Supabase'de o tablo yok) → PostgREST "Could not find the table … in the
 * schema cache" der. Kullanıcının yapması gereken tek şey
 * `docs/supabase-schema.sql`'i yeniden çalıştırmak; dosya idempotent.
 */
function describeSyncError(errors: string[]): string {
  const missing = errors.find(
    (e) => /could not find the table/i.test(e) || /PGRST205/.test(e)
  );
  if (missing) {
    const m = /public\.([a-z_]+)/i.exec(missing);
    return `${SCHEMA_OUTDATED}${m ? ` (${m[1]})` : ""}`;
  }
  // Birden çok farklı hata varsa ilkini göster, sayıyı ekle.
  return errors.length > 1 ? `${errors[0]} (+${errors.length - 1})` : errors[0];
}

// UI'da gösterilecek metin i18n'den gelmeli ama engine React dışı → t() kullan.
const SCHEMA_OUTDATED = "__SCHEMA_OUTDATED__";
export { SCHEMA_OUTDATED };

// ── Tetikleyiciler ─────────────────────────────────────────────────────────

let changeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Yerelde veri değişti — senkronu debounce'lu tetikler.
 * Senkron kapalı/oturum yoksa hiçbir şey yapmaz (her yazma yolundan
 * güvenle çağrılabilir).
 */
export function notifyLocalChange(): void {
  if (!isSyncConfigured()) return;
  if (changeTimer) clearTimeout(changeTimer);
  // 3sn → 8sn ve TAM tur yerine yalnız PUSH: bir şarkı dinlemek bile
  // play_history yazdığı için eski hâli dakikada birkaç kez tam tur
  // çalıştırıyordu (her turda tablo başına bir pull isteği).
  changeTimer = setTimeout(() => {
    changeTimer = null;
    void syncNow("push");
  }, 8000);
}

// Uzaktan veri geldiğinde UI'ın kendini tazelemesi için (playlist listesi vb.).
const remoteListeners = new Set<() => void>();
export function onRemoteApplied(fn: () => void): () => void {
  remoteListeners.add(fn);
  return () => remoteListeners.delete(fn);
}
function notifyRemoteApplied() {
  for (const fn of remoteListeners) fn();
}

// Uzaktan değişiklik bildirimi geldi → yalnız PULL (bizim push'umuz zaten
// olan biteni buluta yazdı; tam tur atmak gereksiz ikinci tur demek).
let remotePullTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRemotePull(): void {
  if (remotePullTimer) clearTimeout(remotePullTimer);
  remotePullTimer = setTimeout(() => {
    remotePullTimer = null;
    void syncNow("pull");
  }, 4000);
}

let channel: RealtimeChannel | null = null;
let periodic: ReturnType<typeof setInterval> | null = null;
let started = false;

/** Oturum açıkken canlı senkronu başlatır (realtime + periyodik + odak). */
export async function startSync(): Promise<void> {
  if (!isTauri() || !isSyncConfigured() || started) return;
  const userId = await getUserId();
  if (!userId) return;
  started = true;

  const sb = getSupabase();
  if (sb) {
    // CANLI: diğer cihaz yazdığı anda haber gelir → pull. Debounce, aynı anda
    // gelen çok sayıda satır için tek tur çalıştırır.
    channel = sb.channel("resonance-sync");
    for (const spec of TABLES) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: spec.name,
          filter: `user_id=eq.${userId}`,
        },
        () => scheduleRemotePull()
      );
    }
    channel.subscribe();
  }

  // Yedek tetikler: realtime kopabilir (uyku, ağ değişimi).
  // Yedek tam tur: realtime kopabilir (uyku, ağ değişimi).
  periodic = setInterval(() => void syncNow("full"), 10 * 60 * 1000);
  window.addEventListener("focus", onFocus);

  void syncNow();
}

function onFocus() {
  void syncNow();
}

export function stopSync(): void {
  started = false;
  if (channel) {
    void channel.unsubscribe();
    channel = null;
  }
  if (periodic) {
    clearInterval(periodic);
    periodic = null;
  }
  if (changeTimer) {
    clearTimeout(changeTimer);
    changeTimer = null;
  }
  window.removeEventListener("focus", onFocus);
  setState({ status: "off", pushed: 0, pulled: 0 });
}

// ── İlk senkron modları ────────────────────────────────────────────────────

/**
 * "Bu cihaz kaynak": tüm yerel veriyi buluta yükler.
 * Su terazilerini sıfırlar → her satır yeniden push edilir.
 */
export async function firstSyncPushAll(): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE sync_state SET last_pushed = 0`);
  for (const spec of TABLES) await writeWatermark(spec.name, { lastPushed: 0 });
  await syncNow();
}

/**
 * "Buluttan al": YEREL veriyi bulutun kopyasıyla değiştirir.
 *
 * ⚠️ YIKICI. Çağıranın ÖNCE `backup_db` ile yedek alması ZORUNLU.
 *
 * `tracks` BİLEREK SİLİNMEZ: `cache` tablosu tracks'e ON DELETE CASCADE ile
 * bağlı → tracks silinseydi İNDİRİLMİŞ DOSYA KAYITLARI da uçar, uygulama
 * diskteki sesleri "indirilmemiş" sanardı. tracks yalnızca metadata olduğu
 * ve anahtarı YouTube id'si olduğu için birleşmesi zararsız (kopya oluşmaz).
 */
export async function firstSyncPullReplace(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM playlist_tracks`);
  await db.execute(`DELETE FROM playlists`);
  await db.execute(`DELETE FROM votes`);
  await db.execute(`DELETE FROM play_history`);
  await db.execute(`DELETE FROM recommendation_history`);
  await db.execute(`DELETE FROM now_playing`);
  await db.execute(`DELETE FROM blocked_artists`);
  // Her şeyi baştan çek; push terazisini de sıfırla ki yerelde KALAN
  // (silinmemiş) tracks satırları da buluta gitsin.
  for (const spec of TABLES) {
    await writeWatermark(spec.name, { lastPulled: "", lastPushed: 0 });
  }
  await syncNow();
}
