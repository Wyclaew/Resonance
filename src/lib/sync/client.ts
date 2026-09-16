import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSyncConfigured, syncAnonKey, syncUrl } from "./config";

// Supabase istemcisi (tekil). Yapılandırılmamışsa null döner ve senkronla
// ilgili her şey sessizce devre dışı kalır — uygulama tamamen yerel çalışır.

let client: SupabaseClient | null = null;
let clientUrl = "";

/** Proje değiştirildiğinde istemciyi düşür (bir sonraki çağrı yenisini kurar). */
export function resetSupabase(): void {
  client = null;
  clientUrl = "";
}

export function getSupabase(): SupabaseClient | null {
  if (!isSyncConfigured()) return null;
  // Proje adresi değiştiyse eski istemci yanlış projeye bağlıdır.
  if (client && clientUrl !== syncUrl()) resetSupabase();
  if (!client) {
    clientUrl = syncUrl();
    client = createClient(syncUrl(), syncAnonKey(), {
      auth: {
        // Oturum localStorage'da kalır → uygulama her açılışta yeniden
        // giriş istemez. Tauri webview'inde localStorage kalıcıdır.
        persistSession: true,
        autoRefreshToken: true,
        // ⚠️ Depoyu AÇIKÇA veriyoruz. supabase-js "tarayıcıda mıyım" sorusunu
        // `document`in varlığıyla yanıtlıyor; React Native'de `document` YOK →
        // kendi bellek deposuna düşüyor ve oturum her açılışta kayboluyordu
        // (ölçüldü: mobilde AsyncStorage'da oturum anahtarı hiç oluşmadı).
        // Masaüstünde bu değer zaten localStorage → davranış değişmez.
        storage: typeof localStorage !== "undefined" ? localStorage : undefined,
      },
    });
  }
  return client;
}

/** Giriş yapılmış kullanıcının id'si (yoksa null). */
export async function getUserId(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function signIn(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("sync-not-configured");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUp(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("sync-not-configured");
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data.user;
}

/**
 * Şifre sıfırlama e-postası gönderir.
 *
 * ⚠️ Bağlantı Supabase'deki **Site URL**'ine gider (Authentication → URL
 * Configuration). Masaüstü uygulamasının web sayfası olmadığı için oraya bir
 * adres tanımlı değilse bağlantı boşa düşer; o durumda şifre Supabase
 * panelinden sıfırlanır. Bu bir istemci hatası değil, kurulum ayarıdır.
 */
export async function resetPassword(email: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("sync-not-configured");
  const { error } = await sb.auth.resetPasswordForEmail(email.trim());
  if (error) throw error;
}

/**
 * Şifre sıfırlamayı UYGULAMA İÇİNDE tamamlar.
 *
 * NEDEN GEREKLİ: sıfırlama e-postasındaki bağlantı Supabase'in **Site URL**'ine
 * gider — varsayılan `http://localhost:3000`, yani masaüstü uygulamasında
 * açılacak bir sayfa YOK. Ama bağlantının kendisi geçerlidir: adres
 * çengelinde (#) `access_token` + `refresh_token` taşır. Kullanıcı bağlantıyı
 * buraya yapıştırır, token'larla oturum kurulur ve yeni şifre yazılır.
 * Böylece web sayfası barındırmaya gerek kalmaz.
 */
export async function completePasswordReset(link: string, newPassword: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("sync-not-configured");
  const raw = link.trim();
  const frag = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw;
  const q = new URLSearchParams(frag);
  const access_token = q.get("access_token");
  const refresh_token = q.get("refresh_token");
  if (!access_token || !refresh_token) throw new Error("invalid-reset-link");
  const { error: e1 } = await sb.auth.setSession({ access_token, refresh_token });
  if (e1) throw e1;
  const { error: e2 } = await sb.auth.updateUser({ password: newPassword });
  if (e2) throw e2;
}

/**
 * Çıkışı KULLANICI mı istedi?
 *
 * ⚠️ Oturum kendiliğinden de düşebiliyor (yenileme jetonu süresi dolar ya da
 * uygulama çevrimdışı açılırsa supabase-js oturumu temizler). O zaman senkron
 * SESSİZCE durur: kullanıcı hâlâ senkronlandığını sanır, diğer cihazdaki
 * değişiklikler gelmez. Ayrımı bu bayrakla yapıp yalnız beklenmedik düşmede
 * uyarıyoruz.
 */
let intentionalSignOut = false;

export function wasSignOutIntentional(): boolean {
  return intentionalSignOut;
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  intentionalSignOut = true;
  await sb.auth.signOut();
  // Bayrağı kısa süre sonra bırak: olay zaten geldi.
  setTimeout(() => {
    intentionalSignOut = false;
  }, 3000);
}
