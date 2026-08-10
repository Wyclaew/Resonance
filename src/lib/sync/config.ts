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

export function isSyncConfigured(): boolean {
  return SUPABASE_URL.trim().length > 0 && SUPABASE_ANON_KEY.trim().length > 0;
}
