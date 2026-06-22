import Database from "@tauri-apps/plugin-sql";

// Resonance yerel SQLite veritabanı.
// Migration'lar Rust tarafında (src-tauri/src/lib.rs) tanımlı ve ilk
// load() çağrısında çalışır. Bağlantı tek seferlik (singleton) tutulur.

let dbPromise: Promise<Database> | null = null;

// Uygulama Tauri içinde mi çalışıyor (yoksa düz tarayıcı/Vite önizlemesi mi)?
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    if (!isTauri()) {
      return Promise.reject(
        new Error("Veritabanı yalnızca Tauri uygulaması içinde kullanılabilir.")
      );
    }
    dbPromise = Database.load("sqlite:resonance.db");
  }
  return dbPromise;
}
