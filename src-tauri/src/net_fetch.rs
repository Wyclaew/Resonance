//! WEBVIEW AĞI ÇALIŞMAZSA YEDEK HTTP YOLU (v1.9.7).
//!
//! ⛔ NEDEN: kullanıcı Windows'ta hesaba girerken "Failed to fetch" aldı; Mac'te
//! aynı hesap çalışıyordu. Bu hata tarayıcı motorunun AĞ KATMANINDA patladığını
//! söyler (DNS, proxy, antivirüsün HTTPS taraması, sertifika, saat) — sunucu
//! cevabı bile gelmemiştir ve sebebi JS'ten GÖRÜLEMEZ.
//!
//! Bu komut aynı isteği uygulamanın kendi HTTP istemcisiyle (reqwest + rustls,
//! WebView2'den bağımsız) gönderir. İki işe yarar: (1) sorun WebView2'ye
//! özgüyse giriş ve senkron yine çalışır; (2) burada da başarısız olursa hata
//! SINIFLANDIRILIR ("DNS çözülemedi", "sertifika/saat", "zaman aşımı") —
//! kullanıcıya ne yapacağı söylenebilir.
//!
//! Güvenlik: yalnız HTTPS; yerel/özel adreslere istek atılmaz (webview kodu
//! bizim, ama komutu genel bir vekil yapmamak için).

use std::collections::HashMap;

#[derive(serde::Deserialize)]
pub struct NetRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(serde::Serialize)]
pub struct NetResponse {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
}

fn classify(e: &reqwest::Error) -> String {
    let text = format!("{e:?}").to_lowercase();
    if e.is_timeout() {
        return "zaman aşımı (sunucu 30 sn içinde cevap vermedi)".into();
    }
    if text.contains("dns") || text.contains("failed to lookup") || text.contains("no such host") {
        return "DNS çözülemedi (alan adı bulunamadı — DNS/ISS engeli olabilir)".into();
    }
    if text.contains("certificate") || text.contains("tls") || text.contains("handshake") {
        return "güvenli bağlantı kurulamadı (sertifika — bilgisayarın saati yanlış olabilir ya da antivirüs HTTPS taraması araya giriyor)".into();
    }
    if e.is_connect() {
        return "bağlantı kurulamadı (güvenlik duvarı/proxy engelliyor olabilir)".into();
    }
    format!("ağ hatası: {e}")
}

fn host_allowed(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else { return false };
    let host = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => !(v4.is_loopback() || v4.is_private() || v4.is_link_local()),
            std::net::IpAddr::V6(v6) => !v6.is_loopback(),
        };
    }
    !(host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local"))
}

#[tauri::command]
pub async fn net_fetch(req: NetRequest) -> Result<NetResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let url = reqwest::Url::parse(&req.url).map_err(|e| format!("geçersiz adres: {e}"))?;
        if !host_allowed(&url) {
            return Err("izin verilmeyen adres".to_string());
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(12))
            .build()
            .map_err(|e| e.to_string())?;
        let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
            .map_err(|e| e.to_string())?;
        let mut rb = client.request(method, url);
        for (k, v) in &req.headers {
            // Bu başlıkları istemci kendisi yönetir.
            let lk = k.to_ascii_lowercase();
            if lk == "host" || lk == "content-length" || lk == "connection" {
                continue;
            }
            rb = rb.header(k, v);
        }
        if let Some(b) = req.body {
            rb = rb.body(b);
        }
        let res = rb.send().map_err(|e| classify(&e))?;
        let status = res.status();
        let headers = res
            .headers()
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
            .collect();
        let body = res.text().map_err(|e| classify(&e))?;
        Ok(NetResponse {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").to_string(),
            headers,
            body,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::host_allowed;

    #[test]
    fn only_public_https() {
        let ok = |s: &str| host_allowed(&reqwest::Url::parse(s).unwrap());
        assert!(ok("https://abc.supabase.co/auth/v1/token"));
        assert!(ok("https://my-own-supabase.example.org/rest/v1/x"));
        assert!(!ok("http://abc.supabase.co/"));
        assert!(!ok("https://localhost:3000/"));
        assert!(!ok("https://127.0.0.1/"));
        assert!(!ok("https://192.168.1.10/"));
    }
}

