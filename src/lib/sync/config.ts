// Supabase bağlantı bilgileri.
//
// ⚙️ BURAYI DOLDUR: Supabase panelinde Project Settings → API:
//   • Project URL      → SUPABASE_URL
//   • Project API keys → "anon" / "public"  → SUPABASE_ANON_KEY
//
// 🔐 GÜVENLİK — anon key GİZLİ DEĞİLDİR, gizli olmasına gerek de yoktur:
//   İstemci tarafında çalışmak üzere tasarlanmıştır; veriyi koruyan şey
//   RLS'tir (Row Level Security) — her satır `user_id = auth.uid()` ile
//   kilitli, yani anon key'i olan biri bile SENİN satırlarını göremez.
//   Bu yüzden bu dosya depoya güvenle girer.
//
// ⛔ ASLA `service_role` ANAHTARINI BURAYA KOYMA. O anahtar RLS'i TAMAMEN
//   BYPASS EDER (tüm kullanıcıların tüm verisi). O yalnızca sunucu tarafına
//   aittir; Resonance'ta sunucu yok, dolayısıyla hiç kullanılmaz.
//
// Boş bırakılırsa senkron tamamen kapalıdır ve uygulama eskisi gibi
// %100 yerel çalışır (Ayarlar'da "yapılandırılmamış" görünür).

export const SUPABASE_URL = "https://prwbiclpkuyutfauezxg.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByd2JpY2xwa3V5dXRmYXVlenhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNjMxNzIsImV4cCI6MjEwMTkzOTE3Mn0.YV6IikV81RcKdXayFA41lYK7SDQzO-KIzDaxpHXwHGA";

// ⭐ KENDİ SUPABASE PROJEN (v1.9.6). Depo herkese açık ve buradaki adres/anahtar
// ile gelen herkes AYNI projeye düşerdi (veri güvende — RLS her satırı
// `user_id = auth.uid()` ile kilitler — ama kota, e-posta limiti ve depolama
// ortak olurdu). Artık uygulama içinden kendi projeni verebilirsin; verilen
// değer buradaki varsayılanı EZER.
//
// ⚠️ localStorage'da tutulur (mobil tarafta da aynı arayüz) ve masaüstünde
// `durableStorage` ile diske de yazılır — webview verisi silinse bile kalır.
const URL_OVERRIDE_KEY = "resonance.supabaseUrl";
const KEY_OVERRIDE_KEY = "resonance.supabaseAnonKey";

function readOverride(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Kullanılacak proje adresi: kendi verdiğin varsa o, yoksa gömülü olan. */
export function syncUrl(): string {
  return readOverride(URL_OVERRIDE_KEY) || SUPABASE_URL;
}

export function syncAnonKey(): string {
  return readOverride(KEY_OVERRIDE_KEY) || SUPABASE_ANON_KEY;
}

/** Kendi projesi mi kullanılıyor (arayüzde göstermek için)? */
export function usingOwnProject(): boolean {
  return readOverride(URL_OVERRIDE_KEY).length > 0;
}

/**
 * Kendi projeni ayarla (boş string → gömülü varsayılana dön).
 * ⚠️ Çağıran ÖNCE oturumu kapatmalı: jeton eski projeye ait.
 */
export function setOwnProject(url: string, anonKey: string): void {
  try {
    if (url.trim() && anonKey.trim()) {
      localStorage.setItem(URL_OVERRIDE_KEY, url.trim().replace(/\/+$/, ""));
      localStorage.setItem(KEY_OVERRIDE_KEY, anonKey.trim());
    } else {
      localStorage.removeItem(URL_OVERRIDE_KEY);
      localStorage.removeItem(KEY_OVERRIDE_KEY);
    }
  } catch {
    /* depo yoksa yapılacak bir şey yok */
  }
}

export function isSyncConfigured(): boolean {
  return syncUrl().trim().length > 0 && syncAnonKey().trim().length > 0;
}
