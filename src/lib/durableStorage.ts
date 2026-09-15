import { invoke } from "@tauri-apps/api/core";

// ═══════════════════════════════════════════════════════════════════════════
// KRİTİK localStorage ANAHTARLARININ DİSK YEDEĞİ (yalnız masaüstü).
//
// ⛔ Cihaz kimliği ve Supabase oturumu webview'in localStorage'ında duruyor;
// macOS güncellemesi WebKit veri klasörünü sıfırlayınca ikisi de kayboluyordu
// → aynı Mac her seferinde YENİ bir cihaz olarak görünüyor (Keşfet'te "Başka
// cihaz" listesinde 3 Mac) ve kullanıcı yeniden giriş yapmak zorunda kalıyordu.
// Ayrıntı: `src-tauri/src/durable.rs`.
//
// Yöntem: açılışta, uygulama render edilmeden ÖNCE diskteki kopya localStorage'a
// geri yazılır (localStorage'da yoksa); sonra bu anahtarlara yapılan her yazma
// diske de yansıtılır. Kopyalanan paylaşılan dosyalar (`device.ts`,
// `sync/client.ts`) localStorage kullanmaya devam eder — mobil de öyle.
// ═══════════════════════════════════════════════════════════════════════════

function isDurableKey(key: string): boolean {
  return (
    key === "resonance.deviceId" ||
    // supabase-js oturum anahtarı: sb-<proje>-auth-token
    (key.startsWith("sb-") && key.endsWith("-auth-token"))
  );
}

const pending = new Map<string, string | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function schedule(key: string, value: string | null): void {
  pending.set(key, value);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const entries = Object.fromEntries(pending);
    pending.clear();
    invoke("durable_save", { entries }).catch((e) =>
      console.warn("[resonance] kalıcı yedek yazılamadı:", e)
    );
  }, 250);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

export async function restoreDurableStorage(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }

  try {
    const saved = await withTimeout(
      invoke<Record<string, string>>("durable_load"),
      2000
    );
    const missingOnDisk: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(saved)) {
      if (!isDurableKey(k)) continue;
      if (storage.getItem(k) === null) {
        storage.setItem(k, v);
        console.info(`[resonance] ${k} diskteki yedekten geri yüklendi`);
      }
    }
    // Ters yön: yedeği henüz olmayan anahtarlar (bu sürüme ilk geçiş).
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !isDurableKey(k)) continue;
      const v = storage.getItem(k);
      if (v !== null && saved[k] !== v) missingOnDisk[k] = v;
    }
    if (Object.keys(missingOnDisk).length > 0) {
      await invoke("durable_save", { entries: missingOnDisk }).catch(() => {});
    }
  } catch (e) {
    console.warn("[resonance] kalıcı yedek okunamadı:", e);
  }

  // Bundan sonraki yazmaları yansıt. supabase-js oturumu tazeledikçe ve
  // çıkışta anahtarı sildikçe buradan geçer.
  const proto = Object.getPrototypeOf(storage) as Storage;
  const origSet = proto.setItem;
  const origRemove = proto.removeItem;
  proto.setItem = function (this: Storage, key: string, value: string) {
    origSet.call(this, key, value);
    if (this === storage && isDurableKey(key)) schedule(key, String(value));
  };
  proto.removeItem = function (this: Storage, key: string) {
    origRemove.call(this, key);
    if (this === storage && isDurableKey(key)) schedule(key, null);
  };
}
