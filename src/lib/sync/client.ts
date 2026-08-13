import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSyncConfigured } from "./config";

// Supabase istemcisi (tekil). Yapılandırılmamışsa null döner ve senkronla
// ilgili her şey sessizce devre dışı kalır — uygulama tamamen yerel çalışır.

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSyncConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Oturum localStorage'da kalır → uygulama her açılışta yeniden
        // giriş istemez. Tauri webview'inde localStorage kalıcıdır.
        persistSession: true,
        autoRefreshToken: true,
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

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}
