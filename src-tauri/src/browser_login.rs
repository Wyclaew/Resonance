//! TARAYICIDA GİRİŞ — şifre yöneticisinin (Bitwarden vb.) otomatik doldurabilmesi için.
//!
//! NEDEN: şifre yöneticilerinin tarayıcı eklentileri uygulamanın webview'ine
//! GİREMEZ (Tauri penceresi bir tarayıcı sekmesi değil); Bitwarden masaüstü
//! uygulaması da macOS'ta sistem AutoFill sağlayıcısı olarak kayıtlı değil,
//! Windows'ta webview için böyle bir yol hiç yok. Kullanıcı "hesabımı girerken
//! Bitwarden'dan otomatik çeksin" istedi.
//!
//! Çözüm: uygulama yalnız 127.0.0.1'e bağlı, tek kullanımlık küçük bir sunucu
//! açar ve varsayılan tarayıcıda bir giriş formu gösterir. Eklenti formu
//! doldurur, form bu sunucuya gönderilir, bilgiler uygulamaya geçer ve sunucu
//! kapanır. Bilgiler hiçbir yere yazılmaz; uygulama `take_browser_login` ile
//! bir kez alır.
//!
//! Güvenlik: adresteki rastgele jeton olmadan istek reddedilir (aynı makinedeki
//! başka bir süreç tahmin edemez); 5 dakika sonra ya da ilk başarılı gönderimde
//! sunucu kapanır.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

/// Sabit port: şifre yöneticisindeki kayda bir kez "http://127.0.0.1:47831"
/// eklenince her seferinde eşleşsin. Doluysa rastgele porta düşülür.
const PREFERRED_PORT: u16 = 47831;
const LIFETIME: Duration = Duration::from_secs(300);

static CREDENTIALS: Mutex<Option<(String, String)>> = Mutex::new(None);
/// Yeni oturum başlatılınca eski sunucu döngüsü kendini bitirsin.
static SESSION: AtomicU64 = AtomicU64::new(0);

fn random_token() -> String {
    // std'nin RandomState'i işletim sisteminin rastgele kaynağından tohumlanır.
    let mut out = String::new();
    for _ in 0..2 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(Instant::now().elapsed().as_nanos() as u64);
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

#[derive(serde::Serialize)]
pub struct BrowserLogin {
    pub email: String,
    pub password: String,
}

/// Tarayıcıdan gelen bilgileri BİR KEZ verir (sonra bellekten silinir).
#[tauri::command]
pub fn take_browser_login() -> Option<BrowserLogin> {
    CREDENTIALS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .map(|(email, password)| BrowserLogin { email, password })
}

#[tauri::command]
pub fn start_browser_login(app: AppHandle, lang: Option<String>) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", PREFERRED_PORT))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|e| format!("yerel giriş sunucusu açılamadı: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = random_token();
    let url = format!("http://127.0.0.1:{port}/login/{token}");
    let session = SESSION.fetch_add(1, Ordering::SeqCst) + 1;
    let tr = lang.as_deref() != Some("en");

    std::thread::spawn(move || {
        let started = Instant::now();
        while started.elapsed() < LIFETIME && SESSION.load(Ordering::SeqCst) == session {
            match listener.accept() {
                Ok((stream, _)) => {
                    if handle(stream, &token, tr, &app) {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(120));
                }
                Err(_) => break,
            }
        }
        log::info!("tarayıcı giriş sunucusu kapandı");
    });

    open_in_browser(&url)?;
    log::info!("tarayıcıda giriş açıldı (port {port})");
    Ok(url)
}

/// `true` → bilgiler alındı, sunucu kapanabilir.
fn handle(mut stream: TcpStream, token: &str, tr: bool, app: &AppHandle) -> bool {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return false,
    });
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return false;
    }
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let expected = format!("/login/{token}");

    if path != expected {
        respond(&mut stream, "404 Not Found", "text/plain", "not found");
        return false;
    }
    match method {
        "GET" => {
            respond(&mut stream, "200 OK", "text/html; charset=utf-8", &form_page(&expected, tr));
            false
        }
        "POST" => {
            if content_length == 0 || content_length > 16 * 1024 {
                respond(&mut stream, "400 Bad Request", "text/plain", "bad request");
                return false;
            }
            let mut body = vec![0u8; content_length];
            if reader.read_exact(&mut body).is_err() {
                return false;
            }
            let body = String::from_utf8_lossy(&body);
            let mut email = String::new();
            let mut password = String::new();
            for pair in body.split('&') {
                let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                match k {
                    "email" => email = url_decode(v),
                    "password" => password = url_decode(v),
                    _ => {}
                }
            }
            if email.trim().is_empty() || password.is_empty() {
                respond(&mut stream, "200 OK", "text/html; charset=utf-8", &form_page(&expected, tr));
                return false;
            }
            *CREDENTIALS.lock().unwrap_or_else(|e| e.into_inner()) =
                Some((email.trim().to_string(), password));
            respond(&mut stream, "200 OK", "text/html; charset=utf-8", &done_page(tr));
            let _ = app.emit("browser-login", ());
            true
        }
        _ => {
            respond(&mut stream, "405 Method Not Allowed", "text/plain", "method not allowed");
            false
        }
    }
}

fn respond(stream: &mut TcpStream, status: &str, ctype: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\
         X-Frame-Options: DENY\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn page(title: &str, inner: &str) -> String {
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
:root{{color-scheme:dark;--bg:#0b0b0c;--card:#151517;--line:#26262a;--text:#ededee;--muted:#8d8d94;--accent:#e0a33c}}
@media (prefers-color-scheme:light){{:root{{color-scheme:light;--bg:#f4f3ef;--card:#fff;--line:#e3e1da;--text:#1b1b1d;--muted:#6b6a70;--accent:#8a5f16}}}}
*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;padding:24px}}
.card{{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}}
.mark{{display:flex;gap:3px;align-items:center;height:22px;margin-bottom:18px}}.mark i{{display:block;width:3px;border-radius:2px;background:var(--accent)}}
h1{{font-size:20px;margin:0 0 6px;letter-spacing:-.01em}}p{{margin:0 0 20px;color:var(--muted);font-size:13.5px}}
label{{display:block;font-size:12px;color:var(--muted);margin:14px 0 6px}}
input{{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--text);font:inherit;outline:none}}
input:focus{{border-color:var(--accent)}}
button{{margin-top:22px;width:100%;padding:11px;border:0;border-radius:10px;background:var(--accent);color:#111;font:600 14px/1 inherit;cursor:pointer}}
</style></head><body><main class="card">
<div class="mark"><i style="height:8px"></i><i style="height:14px"></i><i style="height:20px"></i><i style="height:12px"></i><i style="height:18px"></i><i style="height:10px"></i><i style="height:6px"></i></div>
{inner}</main></body></html>"#
    )
}

fn form_page(action: &str, tr: bool) -> String {
    let (title, lead, email, pass, submit) = if tr {
        (
            "Resonance'a giriş",
            "Şifre yöneticin bu formu doldurabilir. Bilgiler yalnız bu bilgisayardaki Resonance uygulamasına gider.",
            "E-posta",
            "Şifre",
            "Giriş yap",
        )
    } else {
        (
            "Sign in to Resonance",
            "Your password manager can fill this form. The details only go to the Resonance app on this computer.",
            "Email",
            "Password",
            "Sign in",
        )
    };
    page(
        title,
        &format!(
            r#"<h1>{title}</h1><p>{lead}</p>
<form method="post" action="{action}" autocomplete="on">
<label for="email">{email}</label><input id="email" name="email" type="email" autocomplete="username" required autofocus>
<label for="password">{pass}</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">{submit}</button></form>"#
        ),
    )
}

fn done_page(tr: bool) -> String {
    let (title, body) = if tr {
        ("Resonance'a dönebilirsin", "Bilgiler uygulamaya iletildi. Bu sekmeyi kapatabilirsin.")
    } else {
        ("You can return to Resonance", "The details were passed to the app. You can close this tab.")
    };
    page(title, &format!("<h1>{title}</h1><p>{body}</p>"))
}

fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c.creation_flags(0x08000000); // CREATE_NO_WINDOW
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| format!("tarayıcı açılamadı: {e}"))
}

#[cfg(test)]
mod tests {
    use super::url_decode;

    #[test]
    fn decodes_form_values() {
        assert_eq!(url_decode("eren%40example.com"), "eren@example.com");
        assert_eq!(url_decode("a+b%2Bc%25"), "a b+c%");
        assert_eq!(url_decode("%C3%BC%C5%9F"), "üş");
        assert_eq!(url_decode("bad%zz"), "bad%zz");
        assert_eq!(url_decode("end%4"), "end%4");
    }
}
