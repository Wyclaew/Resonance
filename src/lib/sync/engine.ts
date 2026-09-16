import type { RealtimeChannel } from "@supabase/supabase-js";
import { getDb, isTauri } from "../db";
import { getSupabase, getUserId } from "./client";
import { isSyncConfigured } from "./config";
import { loadSettings, setSetting } from "../settings";

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
  // Haftalık Keşif listesi (JSON, ~6 KB): tüm cihazlarda AYNI hafta listesi
  // görünsün diye senkronlanır.
  "discover.week",
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
      "created_at", "folder", "updated_at", "deleted",
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

// ⭐ 24 SAATTE BİR TAM TUR ("derin onarım"). Geriye pay yeni kaymayı önler ama
// GEÇMİŞTE kaçmış satırları geri getirmez. Tablolar küçük (birkaç yüz satır),
// günde bir kez baştan çekmek ucuz ve iki cihazı kendiliğinden eşitler.
const DEEP_PULL_EVERY_MS = 24 * 3600 * 1000;
const DEEP_PULL_KEY = "sync.lastDeepPull";
const PAGING_FIX_KEY = "sync.pagingFix193";
let deepSyncPending = false;
/** `repairSync` bir turu zorla derin yapar (damga okunmadan). */
let forceDeep = false;
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

// Bulutta NULL gelirse boş metne çekilecek NOT NULL metin sütunları. NULL
// yazılsaydı satır uygulanamaz ve (v1.9.3 öncesi) pull o sayfada takılırdı.
const STR_DEFAULT_EMPTY = new Set(["title", "artist", "queue_json", "file_path"]);

function valuesFor(spec: TableSpec, row: Record<string, unknown>): unknown[] {
  return spec.cols.map((c) => {
    const v = row[c];
    if (v === undefined || v === null) {
      if (NUM_DEFAULT_0.has(c)) return 0;
      if (NUM_DEFAULT_1.has(c)) return 1;
      if (STR_DEFAULT_EMPTY.has(c)) return "";
      // tracks.source / source_id kimlikten türetilebilir ("youtube:ID").
      if (spec.name === "tracks" && (c === "source" || c === "source_id")) {
        const id = String(row.id ?? "");
        const i = id.indexOf(":");
        if (i > 0) return c === "source" ? id.slice(0, i) : id.slice(i + 1);
      }
      return null;
    }
    return v;
  });
}

/**
 * Liste üyeliklerinin işaret ettiği parçalar yerelde yoksa buluttan getirir;
 * bulutta da yoksa YER TUTUCU açar (başlık boş, `updated_at = 0` → gerçek satır
 * gelince ezilir). Yer tutucunun adı `onPlaceholders` dinleyicisiyle doldurulur
 * (masaüstünde YouTube'dan). Böylece üyelik yabancı anahtar hatasıyla KAYBOLMAZ.
 *
 * Mobilde aynı iş bir DB tetikleyicisiyle de yapılıyor; `INSERT OR IGNORE`
 * olduğu için ikisi çakışmaz.
 */
async function ensureParentTracks(rows: Record<string, unknown>[], userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const db = await getDb();
  const ids = [...new Set(rows.map((r) => String(r.track_id ?? "")).filter(Boolean))];
  if (ids.length === 0) return;
  const missing: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const ph = part.map((_, j) => `$${j + 1}`).join(", ");
    const have = await db.select<{ id: string }[]>(
      `SELECT id FROM tracks WHERE id IN (${ph})`,
      part
    );
    const set = new Set(have.map((h) => h.id));
    for (const id of part) if (!set.has(id)) missing.push(id);
  }
  if (missing.length === 0) return;

  const spec = TABLES.find((t) => t.name === "tracks")!;
  const sql = upsertSql(spec);
  const found = new Set<string>();
  for (let i = 0; i < missing.length; i += 100) {
    const { data, error } = await sb
      .from("tracks")
      .select("*")
      .eq("user_id", userId)
      .in("id", missing.slice(i, i + 100));
    if (error) break;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      try {
        await db.execute(sql, valuesFor(spec, row));
        found.add(String(row.id));
      } catch (e) {
        console.error(`[sync] eksik parça uygulanamadı (${String(row.id)}):`, e);
      }
    }
  }
  const placeholders = missing.filter((id) => !found.has(id));
  for (const id of placeholders) {
    const i = id.indexOf(":");
    if (i <= 0) continue;
    await db
      .execute(
        `INSERT OR IGNORE INTO tracks
           (id, source, source_id, title, artist, duration_ms, added_at, updated_at)
         VALUES ($1, $2, $3, '', '', 0, $4, 0)`,
        [id, id.slice(0, i), id.slice(i + 1), Date.now()]
      )
      .catch(() => {});
  }
  console.warn(
    `[sync] ${missing.length} üyeliğin parçası yerelde yoktu: ${found.size} buluttan geldi, ` +
      `${placeholders.length} yer tutucu açıldı`
  );
  if (placeholders.length > 0) for (const fn of placeholderListeners) fn();
}

const placeholderListeners = new Set<() => void>();
/** Pull yer tutucu parça açınca çağrılır (adlarını doldurmak için). */
export function onPlaceholders(fn: () => void): () => void {
  placeholderListeners.add(fn);
  return () => placeholderListeners.delete(fn);
}

// ── Pull ───────────────────────────────────────────────────────────────────

async function pullTable(spec: TableSpec, userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const db = await getDb();
  const sql = upsertSql(spec);

  const { lastPulled } = await readWatermarks(spec.name);
  // ⭐⭐ SU TERAZİSİNE GERİYE PAY (v1.9.2) — CİHAZLAR ARASI SATIR KAYBININ KÖKÜ.
  //
  // `synced_at` sunucuda TRIGGER ile yazılır ve Postgres'te `now()` işlem
  // BAŞLANGIÇ zamanıdır. İki cihaz aynı anda yazarken: A işlemi T1'de başlar,
  // B işlemi T2'de (T2 > T1) başlar ama B ÖNCE commit eder. Tam bu aralıkta
  // pull yapan cihaz yalnız B'yi görür ve su terazisini T2'ye taşır; A commit
  // ettiğinde damgası T1 (< T2) olduğu için `gt(synced_at, T2)` filtresine
  // ARTIK HİÇ TAKILMAZ → o satır o cihaza SONSUZA DEK gelmez.
  // Kullanıcının gördüğü tablo: "Favorite Songs Mac'te 240, Windows'ta 241".
  //
  // Çözüm: pencereyi biraz geriden başlat. Upsert'ler idempotent (LWW), aynı
  // satırı tekrar almak zararsız — sadece birkaç satırlık fazladan iş.
  const OVERLAP_MS = 2 * 60 * 1000;
  const base = lastPulled || EPOCH0;
  let since = base;
  if (deepSyncPending) {
    // 24 saatte bir TAM tur: eski kaçmış satırlar da onarılsın.
    since = EPOCH0;
  } else if (lastPulled) {
    const t = Date.parse(lastPulled);
    if (Number.isFinite(t)) since = new Date(t - OVERLAP_MS).toISOString();
  }
  let applied = 0;

  // ⭐⭐ SAYFALAMA: `synced_at > imleç` YETMİYORDU (v1.9.3) — TEMİZ KURULUMDA
  // YÜZLERCE SATIR KAYBI. Push 400'lük yığınlarla yazar ve bir yığındaki TÜM
  // satırlar AYNI `synced_at`'i taşır (trigger `now()` = işlem başlangıcı).
  // 500'lük sayfa "yığın 1 (400) + yığın 2'nin 100'ü" olunca imleç yığın 2'nin
  // zamanına geçiyor, `gt` yığın 2'nin kalan 300 satırını ATLIYORDU. Kullanıcı
  // Mac'i sıfırdan kurunca yüzlerce parça gelmedi, onlara bağlı liste
  // üyelikleri yabancı anahtar hatasıyla düştü: Favorite Songs 241 → 163.
  // Artık `gte` + aynı zamandaki satırlar için ofset; sıra birincil anahtarla
  // kesinleştirilir (ofset ancak sıra belirliyse güvenli).
  const conflictCols = spec.conflict.split(",").map((c) => c.trim());
  let cursor = since;
  let skipAtCursor = 0; // imleçle AYNI zamandaki satırlardan kaçı işlendi
  let firstPage = true;
  // Kalıcı damga YALNIZ hatasız ilerlenen noktaya kadar yazılır; hata olursa
  // sonraki tur o noktadan yeniden dener. Sayfalama ise hatada DURMAZ —
  // eskiden ilk hatada döngü kırılıyor ve sonraki sayfalar hiç gelmiyordu.
  let blocked = false;
  const failed: Record<string, unknown>[] = [];

  for (;;) {
    let q = sb
      .from(spec.name)
      .select("*")
      .eq("user_id", userId)
      // İlk sayfada `gt`: damgadaki satırlar zaten uygulanmıştı.
      [firstPage ? "gt" : "gte"]("synced_at", cursor)
      .order("synced_at", { ascending: true });
    for (const c of conflictCols) q = q.order(c, { ascending: true });
    const offset = firstPage ? 0 : skipAtCursor;
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${spec.name} pull: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;

    // Üyeliklerin parçaları eksikse önce onları getir (yoksa FK hatası).
    if (spec.name === "playlist_tracks") await ensureParentTracks(rows, userId);

    for (const row of rows) {
      try {
        // Beyaz liste dışı satırı yerele YAZMA (bulutta eski bir sürümden
        // kalmış olabilir); damga yine ilerlesin, yoksa takılırdı.
        if (!(spec.pullKeep && !spec.pullKeep(row))) {
          await db.execute(sql, valuesFor(spec, row));
          applied++;
        }
      } catch (e) {
        // Satırın KİMLİĞİNİ de yaz: kimliksiz hata ayıklanamıyor (mobilde
        // 54 satır bu yüzden sessizce düşerken sebebi bulunamadı).
        const key = conflictCols
          .map((c) => `${c}=${String(row[c] ?? "?")}`)
          .join(" ");
        console.error(`[sync] ${spec.name} satırı uygulanamadı (${key}):`, e);
        failed.push(row);
        if (!blocked) {
          blocked = true;
          // Bu satırın ÖNCESİ güvenli; bir sonraki tur buradan başlasın.
          if (cursor !== since) await writeWatermark(spec.name, { lastPulled: cursor });
        }
      }
    }

    // İmleci ilerlet: son satırın zamanı + o zamandaki satır sayısı.
    const lastTs = String(rows[rows.length - 1].synced_at);
    const atLast = rows.filter((r) => String(r.synced_at) === lastTs).length;
    skipAtCursor = !firstPage && lastTs === cursor ? skipAtCursor + atLast : atLast;
    cursor = lastTs;
    firstPage = false;
    if (rows.length < PAGE) break;
  }
  // ⚠️ Damga ancak TÜM sayfalar bitince yazılır: aynı zamanlı bir grubun
  // ortasında yazılsaydı sonraki tur `gt` ile grubun kalanını atlardı. (Yarıda
  // kesilen tur baştan tekrarlanır — upsert'ler idempotent.)
  if (!blocked && cursor !== since) {
    await writeWatermark(spec.name, { lastPulled: cursor });
  }

  // İkinci şans: başarısız satırları bir kez daha dene (aynı turda ebeveyni
  // sonradan gelmiş olabilir).
  if (failed.length > 0) {
    let still = 0;
    for (const row of failed) {
      try {
        await db.execute(sql, valuesFor(spec, row));
        applied++;
      } catch {
        still++;
      }
    }
    if (still === 0) {
      await writeWatermark(spec.name, { lastPulled: cursor });
      console.warn(`[sync] ${spec.name}: ${failed.length} satır ikinci denemede uygulandı`);
    } else {
      console.error(`[sync] ${spec.name}: ${still} satır uygulanamadı, sonraki turda yeniden denenecek`);
    }
  }

  return applied;
}

// ── Push ───────────────────────────────────────────────────────────────────

async function pushTable(spec: TableSpec, userId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const db = await getDb();
  const { lastPushed } = await readWatermarks(spec.name);
  // v1.9.3 öncesi oy yazımı `updated_at` vermiyordu (0) → hiç gönderilmemiş
  // oylar. "Şimdi" damgasıyla işaretle ki bu turda buluta çıksınlar. Yalnız
  // olay tablolarında güvenli: `tracks`'te 0 bilerek YER TUTUCU demek.
  if (spec.name === "votes") {
    await db.execute(`UPDATE votes SET updated_at = $1 WHERE updated_at = 0`, [Date.now()]);
  }
  // ⭐⭐ PUSH TARAFINDA DA GERİYE PAY (v1.9.2) — kaybolan satırın ASIL yeri.
  //
  // Su terazisi, gönderilen satırların EN BÜYÜK `updated_at`'ine taşınıyor.
  // Ama `updated_at` cihaz saatinden gelir ve TOPLU yazımlarda (liste içe
  // aktarma, çoklu ekleme) çok sayıda satır AYNI milisaniyeyi taşır. Seçim
  // yapıldıktan sonra aynı damgayla yazılan bir satır `> lastPushed`
  // koşuluna bir daha TAKILMAZ → o satır buluta HİÇ çıkmaz.
  // Kullanıcının tablosu: "Windows'ta 241, Mac'te 240" — eksik satır Mac'e
  // gelmiyordu çünkü buluta hiç ulaşmamıştı.
  //
  // Çözüm: pencereyi 60 sn geriden başlat (upsert idempotent, LWW zaten
  // eskiyi ezmiyor) + derin turda HER ŞEYİ yeniden gönder.
  const PUSH_OVERLAP_MS = 60 * 1000;
  const from = deepSyncPending ? 0 : Math.max(0, lastPushed - PUSH_OVERLAP_MS);

  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT ${spec.cols.join(", ")} FROM ${spec.name}
     WHERE updated_at > $1${spec.pushWhere ? ` AND ${spec.pushWhere}` : ""}
     ORDER BY updated_at ASC`,
    [from]
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
    // Derin onarım turu mu? (günde bir; push'u da kapsar → kaçmış satırlar
    // buluta çıkar, sonra diğer cihaz onları çeker.)
    deepSyncPending = false;
    if (mode === "full") {
      try {
        const settings = await loadSettings();
        const last = Number(settings[DEEP_PULL_KEY] ?? 0);
        deepSyncPending =
          forceDeep ||
          !Number.isFinite(last) ||
          Date.now() - last > DEEP_PULL_EVERY_MS ||
          // v1.9.3 sayfalama düzeltmesinden sonra BİR KEZ baştan çek: eski
          // sürümün atladığı satırlar ancak böyle gelir (damga zaten ileride).
          settings[PAGING_FIX_KEY] !== "1";
      } catch {
        deepSyncPending = false;
      }
      if (deepSyncPending) console.info("[resonance] senkron: derin onarım turu");
    }

    const doPush = async () => {
      for (const spec of TABLES) {
        pushed += await guard(`${spec.name} push`, () => pushTable(spec, userId));
      }
    };
    const doPull = async () => {
      for (const spec of TABLES) {
        pulled += await guard(`${spec.name} pull`, () => pullTable(spec, userId));
      }
    };

    // ⛔ DERİN TURDA ÖNCE ÇEK (v1.9.3). Bulutta son-yazan-kazanır koruması YOK
    // (upsert satırı koşulsuz ezer). Derin push TÜM yerel satırları gönderdiği
    // için, önce gönderilirse bu cihazın ESKİ kopyası diğer cihazdaki YENİ bir
    // değişikliği (silme, oy geri alma) buluta geri yazabilirdi. Önce çekince
    // yerel satırlar zaten LWW ile birleşmiş en yeni hâli taşır.
    // Normal turda sıra push → pull kalır: push yalnız son değişenleri gönderir.
    if (deepSyncPending && mode === "full") {
      await doPull();
      await doPush();
    } else {
      if (mode !== "pull") await doPush();
      if (mode !== "push") await doPull();
    }
    // Hatalı turu "tamamlandı" sayma: onarım (özellikle bir kerelik sayfalama
    // onarımı) ağ hatasında sessizce atlanmasın.
    if (mode !== "push" && deepSyncPending && errors.length === 0) {
      try {
        await setSetting(DEEP_PULL_KEY, String(Date.now()));
        await setSetting(PAGING_FIX_KEY, "1");
        console.info("[resonance] senkron: derin onarım turu tamamlandı");
      } catch {
        /* damga yazılamadıysa bir dahaki turda yine denenir */
      }
    }

    deepSyncPending = false;
    setState({
      status: errors.length > 0 ? "error" : "idle",
      lastSyncAt: Date.now(),
      pushed,
      pulled,
      lastError: errors.length > 0 ? describeSyncError(errors) : null,
    });
    if (pulled > 0) notifyRemoteApplied();
    if (errors.length > 0) scheduleRetry(errors);
    else retryAttempt = 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync] tur başarısız:", e);
    setState({ status: "error", lastError: msg });
    scheduleRetry([msg]);
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      void syncNow();
    }
  }
}

// ⭐ HATADAN SONRA KENDİLİĞİNDEN YENİDEN DENE (v1.9.3): ağ hatasıyla biten tur
// eskiden bir sonraki odak/10 dk'lık tura kadar bekliyordu; bu arada verilen
// oy diğer cihaza geçmiyordu. 30 sn → 1 → 2 → 4 → en çok 5 dk. Şema hatası
// kendiliğinden düzelmez → yeniden denenmez.
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRetry(errors: string[]): void {
  if (!started) return;
  if (errors.some((e) => /could not find the table/i.test(e) || /PGRST205/.test(e))) return;
  if (retryTimer) return;
  const delay = Math.min(5 * 60_000, 30_000 * 2 ** retryAttempt);
  retryAttempt++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncNow("full");
  }, delay);
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
    // ⭐ KOPUP YENİDEN BAĞLANINCA ÇEK (v1.9.3): kanal koptuğu sürede gelen
    // bildirimler KAYBOLUR (realtime geçmişi yeniden oynatmaz). Eskiden bu
    // aradaki değişiklikler 10 dakikalık periyodik tura kadar bekliyordu —
    // üstelik pencere gizliyken (menü çubuğu kipi) odak olayı da gelmiyor.
    let hadError = false;
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        if (hadError) {
          hadError = false;
          console.info("[resonance] senkron: canlı kanal yeniden bağlandı");
          scheduleRemotePull();
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        hadError = true;
      }
    });
  }

  // Yedek tam tur: realtime kopabilir (uyku, ağ değişimi).
  periodic = setInterval(() => void syncNow("full"), 10 * 60 * 1000);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  // ⭐ UYKUDAN UYANMA: bilgisayar uyurken zamanlayıcılar durur; uyanınca ne
  // odak ne ağ olayı garanti. Duvar saati beklenenden çok ilerlediyse uyku
  // olmuştur → tam tur.
  lastBeat = Date.now();
  heartbeat = setInterval(() => {
    const nowMs = Date.now();
    if (nowMs - lastBeat > HEARTBEAT_MS * 3) {
      console.info("[resonance] senkron: uykudan uyanma algılandı");
      void syncNow("full");
    }
    lastBeat = nowMs;
  }, HEARTBEAT_MS);

  void syncNow();
}

const HEARTBEAT_MS = 30_000;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastBeat = 0;

function onFocus() {
  void syncNow();
}

function onOnline() {
  // Ağ yeni geldiğinde DNS/TLS birkaç saniye tutmayabilir.
  setTimeout(() => void syncNow("full"), 2000);
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
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempt = 0;
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  window.removeEventListener("focus", onFocus);
  window.removeEventListener("online", onOnline);
  setState({ status: "off", pushed: 0, pulled: 0 });
}

// ── Senkron sağlığı (yerel ↔ bulut satır sayısı) ───────────────────────────
//
// ⭐ NEDEN (v1.9.5): kullanıcının Mac'i sıfırdan kurulunca buluttan eksik veri
// çekti (Favorite Songs 241 → 163) ve bunu FARK EDEN OLMADI; ancak biri
// veritabanına bakınca ortaya çıktı. Sayıları yan yana göstermek, bir daha
// sessiz kalmasını engeller.

export interface TableHealth {
  table: string;
  local: number;
  cloud: number | null; // null = sayılamadı (ağ/şema)
}

export async function syncHealth(): Promise<TableHealth[]> {
  const sb = getSupabase();
  const db = await getDb();
  const userId = await getUserId();
  const out: TableHealth[] = [];
  for (const spec of TABLES) {
    let local = 0;
    try {
      const rows = await db.select<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM ${spec.name}${spec.pushWhere ? ` WHERE ${spec.pushWhere}` : ""}`
      );
      local = Number(rows[0]?.n ?? 0);
    } catch {
      /* tablo yoksa 0 */
    }
    let cloud: number | null = null;
    if (sb && userId) {
      try {
        // `head: true` → satırları indirmeden yalnız sayıyı getirir.
        const { count, error } = await sb
          .from(spec.name)
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);
        cloud = error ? null : count ?? null;
      } catch {
        cloud = null;
      }
    }
    out.push({ table: spec.name, local, cloud });
  }
  return out;
}

/**
 * "Onar": su terazilerine bakmadan İKİ YÖNDE sıfırdan tam tur.
 * Pull önce çalışır (bkz. derin tur notu) → eski kopya yeniyi ezmez.
 */
export async function repairSync(): Promise<void> {
  try {
    await setSetting(DEEP_PULL_KEY, "0");
    await setSetting(PAGING_FIX_KEY, "0");
  } catch {
    /* damga yazılamasa da tur zorlanır */
  }
  forceDeep = true;
  try {
    await syncNow("full");
  } finally {
    forceDeep = false;
  }
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
