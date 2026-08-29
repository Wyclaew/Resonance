// ═══════════════════════════════════════════════════════════════════════════
// RESONANCE YEREL İNDİRİCİ (v1.8.0)
//
// NEDEN VAR: kullanıcının şikâyeti "neredeyse her şarkıda 'yüklenemedi'".
// Kök neden YouTube'un bot doğrulaması + PO Token zorunluluğu. ÖLÇÜM
// (2026-08-19, gerçek isteklerle):
//
//   • Kendi InnerTube çağrım (IOS / ANDROID istemcisi):
//       player yanıtı OK, ses URL'si geliyor →
//       ilk 1 MB iniyor (206), SONRAKİ parçalar 403.   ← PO Token yok
//   • Kendi InnerTube (WEB_EMBEDDED / MWEB / TVHTML5):
//       player yanıtı bile yok ("This video is unavailable").
//   • yt-dlp'nin ÇÖZDÜĞÜ URL + elle Range istekleri:
//       p1 206, p2 206, tam dosya 200 → KISITSIZ.
//
// ⭐ ÇIKARIM: duvar İNDİRMEDE değil, URL ÇÖZÜMÜNDE. URL bir kez doğru
// çözüldüğünde baytları çekmek serbest. Bu yüzden yerel indirici iki parçadan
// oluşur ve ikisi bağımsız kullanılabilir:
//
//   1) `resolve_innertube` — yt-dlp ÇALIŞTIRMADAN URL çözme denemesi.
//      Başarılıysa yt-dlp süreci hiç başlatılmaz (~1.5-3 sn tasarruf).
//   2) `download_ranged`  — URL'yi parçalı, yeniden denemeli, YARIDA KALIRSA
//      DEVAM EDEN indirici. yt-dlp'nin kendi indirme katmanının yerine geçer.
//
// ⛔ NEDEN "TAMAMEN KENDİ İNDİRİCİMİZ" DEĞİL: URL çözümü imza (`s`), throttle
// (`n`) ve PO Token üretimi için YouTube'un player JavaScript'ini ÇALIŞTIRMAYI
// gerektiriyor. Bunu yeniden yazmak bir JS motoru gömmek + YouTube her
// değiştiğinde kırılmak demek — yt-dlp'nin tek varlık sebebi bu. Ölçüm de
// bunu doğruladı: kendi çözümüm 1 MB'da duvara çarpıyor. Bu yüzden yt-dlp
// YEDEK olarak duruyor ve yalnız URL çözücü rolüne indirgendi.
// ═══════════════════════════════════════════════════════════════════════════

use anyhow::{anyhow, Result};
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

/// Parça boyutu. 1 MB ölçümde her istemcide kabul gördü; daha büyük istekler
/// (tam dosya) kısıtlı URL'lerde doğrudan 403 alıyor.
const CHUNK: u64 = 1024 * 1024;
/// Parça başına deneme sayısı (geçici 403/429/kopma için).
const CHUNK_TRIES: usize = 3;
/// Bu boyuta kadar TEK istekte indirilir (ölçüm: parçalamanın faydası yok).
const SINGLE_SHOT_MAX: u64 = 24 * 1024 * 1024;
/// Parçalı moda düşüldüğünde eşzamanlı istek sayısı.
const PARALLEL: usize = 4;

pub struct AudioSource {
    pub url: String,
    pub user_agent: String,
    pub content_length: u64,
    /// Hangi yol üretti (log/teşhis).
    pub via: String,
}

/// URL'nin kimliğini kabaca temsil eden son parça (mühür için; tam URL uzun).
fn tail(url: &str) -> String {
    let n = url.len();
    url[n.saturating_sub(48)..].to_string()
}

fn http() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()?)
}

struct Profile {
    name: &'static str,
    client_name: &'static str,
    client_version: &'static str,
    client_id: &'static str,
    user_agent: &'static str,
    extra: Option<(&'static str, &'static str)>, // (alan, değer) — cihaz bilgisi
}

// Ölçümde player yanıtı VEREN istemciler. Diğerleri (WEB_EMBEDDED, MWEB,
// TVHTML5) doğrudan çağrıda "video unavailable" döndürüyor; onlar yalnız
// yt-dlp üzerinden çalışıyor.
const PROFILES: [Profile; 2] = [
    Profile {
        name: "ios",
        client_name: "IOS",
        client_version: "20.10.4",
        client_id: "5",
        user_agent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)",
        extra: Some(("deviceModel", "iPhone16,2")),
    },
    Profile {
        name: "android",
        client_name: "ANDROID",
        client_version: "20.10.38",
        client_id: "3",
        user_agent: "com.google.android.youtube/20.10.38 (Linux; U; Android 12; GB) gzip",
        extra: None,
    },
];

/// InnerTube player API'siyle ses URL'si çözmeyi dener (yt-dlp çalıştırmadan).
///
/// `prefer_low`: kullanıcı "düşük kalite" seçtiyse en düşük bit hızlı m4a.
/// Katman 1'in üst üste kaç kez işe yaramadığı + ne zamana kadar askıda.
/// ⚠️ NEDEN: InnerTube yolu PO Token yokken 1 MB indirip 403 alıyor. Her
/// şarkıda bunu tekrarlamak boşa 1 MB veri + ~1 sn demek. Üst üste
/// başarısızlıkta yol geçici olarak devre dışı bırakılır; süre dolunca
/// yeniden denenir (YouTube tarafı değişebilir).
static NATIVE_FAILS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static NATIVE_SKIP_UNTIL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
const NATIVE_FAIL_LIMIT: u32 = 3;
const NATIVE_COOLDOWN_SECS: u64 = 30 * 60;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Katman 1 şu an denenmeli mi?
pub fn native_enabled() -> bool {
    now_secs() >= NATIVE_SKIP_UNTIL.load(std::sync::atomic::Ordering::Relaxed)
}

pub fn note_native_failure() {
    let n = NATIVE_FAILS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if n >= NATIVE_FAIL_LIMIT {
        NATIVE_FAILS.store(0, std::sync::atomic::Ordering::Relaxed);
        NATIVE_SKIP_UNTIL.store(
            now_secs() + NATIVE_COOLDOWN_SECS,
            std::sync::atomic::Ordering::Relaxed,
        );
        log::info!(
            "yerel çözüm {} dk askıya alındı (üst üste {} başarısızlık)",
            NATIVE_COOLDOWN_SECS / 60,
            NATIVE_FAIL_LIMIT
        );
    }
}

pub fn note_native_success() {
    NATIVE_FAILS.store(0, std::sync::atomic::Ordering::Relaxed);
}

pub fn resolve_innertube(video_id: &str, prefer_low: bool) -> Result<AudioSource> {
    let c = http()?;
    let mut last = String::from("bilinmeyen hata");

    for p in PROFILES.iter() {
        let mut client = serde_json::json!({
            "clientName": p.client_name,
            "clientVersion": p.client_version,
            "hl": "en",
            "gl": "US",
            "userAgent": p.user_agent,
        });
        if let Some((k, v)) = p.extra {
            client[k] = serde_json::Value::String(v.to_string());
        }
        let body = serde_json::json!({
            "context": { "client": client },
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true,
        });

        let resp = c
            .post("https://www.youtube.com/youtubei/v1/player")
            .header("Content-Type", "application/json")
            .header("User-Agent", p.user_agent)
            .header("X-Youtube-Client-Name", p.client_id)
            .header("X-Youtube-Client-Version", p.client_version)
            .json(&body)
            .send();

        let v: serde_json::Value = match resp.and_then(|r| r.json()) {
            Ok(v) => v,
            Err(e) => {
                last = format!("{}: {e}", p.name);
                continue;
            }
        };

        let status = v["playabilityStatus"]["status"].as_str().unwrap_or("");
        if status != "OK" {
            let reason = v["playabilityStatus"]["reason"].as_str().unwrap_or("");
            last = format!("{}: {status} {reason}", p.name);
            continue;
        }

        // Yalnız audio/mp4 (AAC) — rodio/symphonia opus çözemiyor.
        let empty = vec![];
        let fmts = v["streamingData"]["adaptiveFormats"]
            .as_array()
            .unwrap_or(&empty);
        let mut best: Option<(u64, u64, String)> = None; // (bitrate, len, url)
        for f in fmts {
            let mime = f["mimeType"].as_str().unwrap_or("");
            if !mime.starts_with("audio/mp4") {
                continue;
            }
            let Some(url) = f["url"].as_str() else { continue }; // şifreli → atla
            let br = f["bitrate"].as_u64().unwrap_or(0);
            let len = f["contentLength"]
                .as_str()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            if len == 0 {
                continue;
            }
            let take = match &best {
                None => true,
                Some((bb, _, _)) => {
                    if prefer_low {
                        br < *bb
                    } else {
                        br > *bb
                    }
                }
            };
            if take {
                best = Some((br, len, url.to_string()));
                // itag'i ayrıca saklamak için aşağıda yeniden okunur.
            }
        }

        if let Some((br, len, url)) = best {
            log::info!("yerel çözüm başarılı {video_id} ({}, {} kbps)", p.name, br / 1000);
            return Ok(AudioSource {
                url,
                user_agent: p.user_agent.to_string(),
                content_length: len,
                via: format!("innertube:{}", p.name),
            });
        }
        last = format!("{}: uygun m4a yok", p.name);
    }
    Err(anyhow!("yerel çözüm başarısız ({last})"))
}


// ═══ URL ÖNBELLEĞİ ═══════════════════════════════════════════════════════
// ⭐ ÖLÇÜM (2026-08-19): bir şarkının hazır olma süresi ~3.3 sn ve bunun
// 2.45 sn'si URL ÇÖZÜMÜ (yt-dlp süreci + çıkarım). İndirmenin kendisi 0.8 sn.
// Yani hızlanmanın asıl kaldıracı indirme değil, URL'yi ÖNCEDEN çözmek.
// Çözülen URL'ler `expire` damgası taşır (genelde ~6 saat); o süre boyunca
// yeniden çözmeye gerek yok — kullanıcı ileri atladığında şarkı anında iner.
struct CachedUrl {
    url: String,
    user_agent: String,
    content_length: u64,
    expires_at: u64,
}

fn url_cache() -> &'static std::sync::Mutex<std::collections::HashMap<String, CachedUrl>> {
    static C: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, CachedUrl>>,
    > = std::sync::OnceLock::new();
    C.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// URL'deki `expire=<unix>` damgasını oku (yoksa 2 saat varsay).
fn expiry_of(url: &str) -> u64 {
    for part in url.split(['?', '&']) {
        if let Some(v) = part.strip_prefix("expire=") {
            if let Ok(t) = v.parse::<u64>() {
                // 60 sn emniyet payı: tam sınırda çözülen URL indirme
                // ortasında geçersizleşmesin.
                return t.saturating_sub(60);
            }
        }
    }
    now_secs() + 2 * 3600
}

pub fn cache_url(video_id: &str, url: &str, user_agent: &str, content_length: u64) {
    if content_length == 0 {
        return;
    }
    if let Ok(mut m) = url_cache().lock() {
        m.insert(
            video_id.to_string(),
            CachedUrl {
                url: url.to_string(),
                user_agent: user_agent.to_string(),
                content_length,
                expires_at: expiry_of(url),
            },
        );
        // Sınırsız büyümesin: süresi geçenleri at.
        let now = now_secs();
        m.retain(|_, v| v.expires_at > now);
    }
}

/// Önbellekte geçerli bir URL var mı?
pub fn cached_source(video_id: &str) -> Option<AudioSource> {
    let m = url_cache().lock().ok()?;
    let c = m.get(video_id)?;
    if c.expires_at <= now_secs() {
        return None;
    }
    Some(AudioSource {
        url: c.url.clone(),
        user_agent: c.user_agent.clone(),
        content_length: c.content_length,
        via: "önbellek".into(),
    })
}

/// Önbellekteki adresi ÜNUT (sağlık testinden kalınca / indirme kopunca).
///
/// ⚠️ Neden gerekli: adresler `expire` damgasına göre ~6 saat geçerli sayılıyor
/// ama YouTube tarafında daha erken ölebiliyorlar. Silinmezse aynı ölü adres
/// her denemede yeniden kullanılıp katmanları boşuna tüketiyor (ölçüldü: bir
/// şarkı 15.6 sn'de hazır oldu).
pub fn forget_url(video_id: &str) {
    if let Ok(mut m) = url_cache().lock() {
        m.remove(video_id);
    }
}

pub fn cached_count() -> usize {
    url_cache().lock().map(|m| m.len()).unwrap_or(0)
}


// ═══ İNDİRME SAĞLIĞI ═════════════════════════════════════════════════════
// ⭐ AKILLI TAMPON: kaç şarkı önden indirileceği SABİT olmamalı. Hızlı ve
// sorunsuz bir bağlantıda 5 şarkıyı önden indirmek boşuna disk+veri; yavaş
// ya da kopan bir bağlantıda 5 bile az. Son indirmelerin hızını ve başarı
// oranını ölçüp tampon önerisini buradan veriyoruz.
struct DlSample {
    bytes: u64,
    secs: f32,
    ok: bool,
}

fn dl_stats() -> &'static std::sync::Mutex<Vec<DlSample>> {
    static S: std::sync::OnceLock<std::sync::Mutex<Vec<DlSample>>> =
        std::sync::OnceLock::new();
    S.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

fn note_download(bytes: u64, secs: f32, ok: bool) {
    if let Ok(mut v) = dl_stats().lock() {
        v.push(DlSample { bytes, secs, ok });
        // Yalnız son 20 indirme sayılır: ağ koşulu değişince eski ölçüm
        // yanıltmasın (otelde/mobil hotspotta bağlanınca hemen uyum sağlasın).
        let len = v.len();
        if len > 20 {
            v.drain(0..len - 20);
        }
    }
}

/// (MB/sn, başarısızlık oranı, önerilen tampon şarkı sayısı)
pub fn health() -> (f32, f32, u32) {
    let Ok(v) = dl_stats().lock() else {
        return (0.0, 0.0, 5);
    };
    if v.is_empty() {
        return (0.0, 0.0, 5);
    }
    let fails = v.iter().filter(|s| !s.ok).count() as f32 / v.len() as f32;
    let oks: Vec<&DlSample> = v.iter().filter(|s| s.ok && s.secs > 0.01).collect();
    let mbps = if oks.is_empty() {
        0.0
    } else {
        oks.iter()
            .map(|s| s.bytes as f32 / s.secs / 1_048_576.0)
            .sum::<f32>()
            / oks.len() as f32
    };

    // Tampon kararı: sorun varsa BÜYÜT (müzik durmasın), her şey yolundaysa
    // KÜÇÜLT (boşuna veri/disk harcama).
    let buffer = if fails > 0.3 || (mbps > 0.0 && mbps < 0.7) {
        8
    } else if fails > 0.1 || (mbps > 0.0 && mbps < 2.0) {
        6
    } else if mbps > 4.0 {
        3
    } else {
        5
    };
    (mbps, fails, buffer)
}



/// ⚠️ WINDOWS: `std::fs::rename` hedef dosya VARSA hata verir (Unix'te üzerine
/// yazar). Yarım kalmış bir indirmeden sonra hedef zaten duruyorsa indirme
/// sessizce başarısız oluyordu — platformlar arası fark, macOS'ta hiç
/// görünmeyen bir Windows hatası.
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if to.exists() {
        let _ = std::fs::remove_file(to);
    }
    std::fs::rename(from, to)
}

/// ⭐ ADRES SAĞLIK TESTİ — indirmeye başlamadan önce URL gerçekten tam mı?
///
/// ÖLÇÜM (2026-08-21): kısıtlı bir adreste (PO Token'sız InnerTube) dosyanın
/// SON 1 KB'ını istemek 403 döndürüyor (0.16 sn); kısıtsız adreste (yt-dlp)
/// aynı istek 206 (0.07 sn). Yani "bu adres sonuna kadar iner mi?" sorusu
/// bir kilobayt ile ve göz açıp kapayana kadar cevaplanıyor.
///
/// Bu test olmadan kısıtlı adres her şarkıda 1 MB indirip 403 alıyor, yani
/// boşa veri + ~1 sn. Şimdi o israf tamamen kalkıyor.
pub fn probe_url(src: &AudioSource) -> bool {
    if src.content_length < 2048 {
        return true; // çok küçük dosyada test anlamsız
    }
    let Ok(c) = http() else { return true };
    let from = src.content_length - 1024;
    let to = src.content_length - 1;
    let end_status = match c
        .get(&src.url)
        .header("User-Agent", &src.user_agent)
        .header("Range", format!("bytes={from}-{to}"))
        .send()
    {
        Ok(r) => {
            if r.status().is_success() {
                return true;
            }
            r.status().as_u16()
        }
        // Ağ hatasında adresi suçlama: indirme yolu kendi retry'ını yapsın.
        Err(_) => return true,
    };

    // ⚠️ SON PARÇA REDDEDİLDİ. Bu, InnerTube adresleri için "kısıtlı" demek
    // (PO Token yok → ilk ~1 MB iner, gerisi 403). AMA yt-dlp'nin çözdüğü
    // adreslerde durum farklı olabilir: bazı ağlarda/istemcilerde YouTube
    // dosyanın SONUNA yapılan atlamalı isteği reddederken sıralı indirmeye
    // izin veriyor (ölçüm: Windows'ta teşhis panelinde "adres kısıtlı" çıkan
    // makinede baştan indirme çalışıyordu). Böyle bir adresi tümden ELEMEK,
    // gerçekten işe yarayan tek katmanı kaybettiriyordu.
    if src.via.starts_with("innertube") {
        log::info!("adres kısıtlı (sağlık testi, HTTP {end_status}): {}", src.via);
        return false;
    }
    let head_ok = c
        .get(&src.url)
        .header("User-Agent", &src.user_agent)
        .header("Range", "bytes=0-1023")
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(true);
    if head_ok {
        log::warn!(
            "adres son parçayı vermiyor (HTTP {end_status}) ama baştan iniyor —              sıralı indirmeye devam: {}",
            src.via
        );
    } else {
        log::info!("adres kısıtlı (sağlık testi, HTTP {end_status}): {}", src.via);
    }
    head_ok
}

/// URL'yi PARÇALI indirir: her parça ayrı `Range` isteği, parça başına
/// yeniden deneme, yarıda kalan dosyadan DEVAM.
///
/// ⚠️ Neden parçalı: ölçümde tam dosyayı tek istekte çekmek kısıtlı URL'lerde
/// doğrudan 403 veriyor; 1 MB'lık istekler kabul ediliyor. Ayrıca parçalı
/// yapı, kopan bağlantıda baştan başlamayı önler (kullanıcının şikâyeti
/// "şarkı ortasında duruyor" idi).
///
/// Dönüş: indirilen bayt sayısı.
pub fn download_ranged(src: &AudioSource, dest: &Path) -> Result<u64> {
    let t_dl = std::time::Instant::now();
    let c = http()?;
    let part = dest.with_extension("part");
    let meta = dest.with_extension("part.meta");

    // ⚠️ DEVAM YALNIZ AYNI KAYNAKTA GEÇERLİ. Katman 1 (InnerTube) 1 MB indirip
    // 403 alıyor ve yarım `.part` bırakıyor; katman 2 BAŞKA bir URL'den
    // (farklı format, farklı bayt dizisi) devam ederse dosya sessizce BOZULUR
    // — çalarken "invalid data" ya da yarısı bozuk ses demektir.
    // Bu yüzden kaynağı `.part.meta` ile mühürlüyoruz.
    let stamp = format!("{}|{}", src.content_length, tail(&src.url));
    let same_source = std::fs::read_to_string(&meta)
        .map(|m| m.trim() == stamp)
        .unwrap_or(false);
    if !same_source {
        let _ = std::fs::remove_file(&part);
    }
    let _ = std::fs::write(&meta, &stamp);

    let mut have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > src.content_length {
        let _ = std::fs::remove_file(&part);
        have = 0;
    }

    // ⭐ HIZLI YOL: TEK İSTEKTE TAM DOSYA.
    // Ölçüm (3.17 MB şarkı): tek istek 0.79 sn · 1 MB sıralı 1.08 sn ·
    // 1 MB paralel×4 0.79 sn. Yani kısıtsız bir URL'de parçalamanın hiçbir
    // faydası yok — üstelik istek sayısı 4 kat artıyor. Parçalama yalnız
    // KISITLI URL'ler (katman 1) ve kopan bağlantılar için gerekli.
    if have == 0 && src.content_length <= SINGLE_SHOT_MAX {
        if let Ok(resp) = c
            .get(&src.url)
            .header("User-Agent", &src.user_agent)
            .header("Range", format!("bytes=0-{}", src.content_length - 1))
            .send()
        {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes() {
                    if bytes.len() as u64 == src.content_length {
                        std::fs::write(&part, &bytes)?;
                        replace_file(&part, dest)?;
                        let _ = std::fs::remove_file(&meta);
                        note_download(src.content_length, t_dl.elapsed().as_secs_f32(), true);
                        return Ok(src.content_length);
                    }
                }
            }
        }
        // Başarısız → aşağıdaki parçalı yola düş (dosya hâlâ boş).
    }

    // ⭐ PARÇALI + PARALEL YOL.
    // Kullanıcının isteği: "şarkıyı birkaç yerinden aynı anda indir".
    // Ölçümde büyük kazanç YOK (0.29 sn) ama zarar da yok (4 eşzamanlı istekte
    // 0 hata) ve YAVAŞ bağlantıda/uzun parçalarda fark açılır. Bu yüzden
    // parçalı yola düşüldüğünde paralel çalışıyoruz.
    // ⚠️ yt-dlp'nin `-N` seçeneği geçmişte 403/416 üretmişti (bkz. CLAUDE.md);
    // fark şu: orada parça sayısı sabit ve agresifti, burada eşzamanlılık 4 ile
    // sınırlı ve her parça kendi içinde yeniden deneniyor.
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .open(&part)?;
    f.seek(SeekFrom::Start(have))?;

    while have < src.content_length {
        // Bu turda indirilecek parçalar (en fazla PARALLEL adet).
        let mut ranges: Vec<(u64, u64)> = Vec::new();
        let mut cursor = have;
        while cursor < src.content_length && ranges.len() < PARALLEL {
            let end = (cursor + CHUNK - 1).min(src.content_length - 1);
            ranges.push((cursor, end));
            cursor = end + 1;
        }

        // Parçaları eşzamanlı çek; SIRAYLA yaz (dosya bütünlüğü için).
        let results: Vec<Result<Vec<u8>>> = std::thread::scope(|scope| {
            let handles: Vec<_> = ranges
                .iter()
                .map(|&(a, b)| {
                    let cl = &c;
                    let src_ref = &src;
                    scope.spawn(move || fetch_chunk(cl, src_ref, a, b))
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().unwrap_or_else(|_| Err(anyhow!("parça thread'i çöktü"))))
                .collect()
        });

        for r in results {
            match r {
                Ok(bytes) if !bytes.is_empty() => {
                    f.write_all(&bytes)?;
                    have += bytes.len() as u64;
                }
                Ok(_) => {
                    drop(f);
                    note_download(have, t_dl.elapsed().as_secs_f32(), false);
                    return Err(anyhow!("boş parça @ {have}"));
                }
                Err(e) => {
                    drop(f);
                    note_download(have, t_dl.elapsed().as_secs_f32(), false);
                    // Yarım dosya BIRAKILIR: aynı kaynakla sonraki deneme
                    // kaldığı yerden sürer (mühür bunu güvenli kılıyor).
                    return Err(anyhow!("{e} @ {have}"));
                }
            }
        }
    }

    f.flush()?;
    drop(f);
    replace_file(&part, dest)?;
    let _ = std::fs::remove_file(&meta);
    note_download(have, t_dl.elapsed().as_secs_f32(), true);
    Ok(have)
}

/// Tek parçayı indirir; geçici hatalarda yeniden dener.
/// 403 = URL kısıtlı (PO Token yok) → yeniden denemek anlamsız, hemen döner ki
/// üst katman başka bir yola geçebilsin.
fn fetch_chunk(
    c: &reqwest::blocking::Client,
    src: &AudioSource,
    a: u64,
    b: u64,
) -> Result<Vec<u8>> {
    let mut err = String::from("bilinmeyen");
    for attempt in 0..CHUNK_TRIES {
        match c
            .get(&src.url)
            .header("User-Agent", &src.user_agent)
            .header("Range", format!("bytes={a}-{b}"))
            .send()
        {
            Ok(resp) if resp.status().is_success() => {
                let bytes = resp.bytes()?;
                if !bytes.is_empty() {
                    return Ok(bytes.to_vec());
                }
                err = "boş yanıt".into();
            }
            Ok(resp) => {
                let code = resp.status().as_u16();
                err = format!("HTTP {code}");
                if code == 403 {
                    return Err(anyhow!("parça indirilemedi ({err})"));
                }
            }
            Err(e) => err = e.to_string(),
        }
        if attempt + 1 < CHUNK_TRIES {
            std::thread::sleep(std::time::Duration::from_millis(400 * (attempt as u64 + 1)));
        }
    }
    Err(anyhow!("parça indirilemedi ({err})"))
}


// ═══════════════════════════════════════════════════════════════════════════
// İNDİRİRKEN ÇALMA (progressive playback)
//
// AMAÇ: şarkının TAMAMI inmeden çalmaya başlamak. Ölçüm: adres önbellekteyken
// bir şarkı ~1.1 sn'de hazır oluyor (0.79 indirme + remux); bu yol ilk sesi
// ~0.3 sn'ye indirir.
//
// NASIL: indirilen baytlar ffmpeg'e BORUDAN (pipe) verilir, ffmpeg ADTS
// çıktısını dosyaya yazar, ses motoru o dosyayı BÜYÜRKEN okur (GrowingFile).
// Üç parça da bağımsız çalışır; herhangi biri patlarsa çağıran taraf normal
// (indir → dönüştür → çal) yoluna düşer.
//
// ⚠️ Neden ADTS: rodio/symphonia MP4/m4a konteynerini çözerken PANİKLİYOR
// (bkz. CLAUDE.md #1); ADTS ise ham akış formatı, yarım dosya bile çalınır.
// ⚠️ Neden `.stream.aac`: yarıda kalan dosya NİHAİ `<id>.aac` adına yazılsaydı
// önbellekte bozuk dosya kalır ve bir daha asla yeniden indirilmezdi.
// Tamamlanınca nihai ada KOPYALANIR (taşıma değil: dosya hâlâ ses motoru
// tarafından açık, Windows'ta taşıma başarısız olurdu).
// ═══════════════════════════════════════════════════════════════════════════

/// Çalmaya başlamadan önce beklenen en az çıktı (~6 sn @128k).
// ⭐ ÖN TAMPON. Eskiden 96 KB idi ≈ 128k'lik seste yalnız **6 saniye**.
// İndirme 6 saniyeden uzun takılırsa (Windows'ta 403 retry'ları yüzünden sık)
// okuyucu yazıcıya YETİŞİYOR; `GrowingFile::read` veri gelene kadar bekliyor ve
// bu bekleme SES CALLBACK'İNİN İÇİNDE oluyor → cızırtı/kesilme. Kullanıcının
// "ses kalitesi bok gibi" dediği tablonun teknik karşılığı bu.
// 448 KB ≈ 28 saniyelik yastık; hızlı bağlantıda maliyeti ~0.15 sn.
const MIN_START_BYTES: u64 = 448 * 1024;
/// Bu süre içinde yeterli veri gelmezse progressive'den vazgeç.
const START_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

pub struct StreamHandle {
    /// Ses motorunun okuyacağı (büyüyen) ADTS dosyası.
    pub path: std::path::PathBuf,
    /// Yazım bitti mi? GrowingFile bunu görünce gerçek EOF döndürür.
    pub done: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// ⚠️ Akış YARIDA KESİLDİ mi? (indirme 403 aldı / bağlantı koptu)
    ///
    /// Bu ayrım kritik: eksik dosyanın sonuna gelen ses motoru bunu "şarkı
    /// bitti" sanıp SONRAKİ ŞARKIYA GEÇİYORDU — kullanıcının gördüğü
    /// "şarkılar 40-45. saniyede kendiliğinden atlıyor" davranışı buydu.
    pub failed: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

/// Dosyayı BÜYÜRKEN okuyan reader. Sona gelince yazım bitene kadar bekler.
pub struct GrowingFile {
    file: std::fs::File,
    done: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl GrowingFile {
    pub fn open(
        path: &Path,
        done: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> std::io::Result<Self> {
        Ok(Self {
            file: std::fs::File::open(path)?,
            done,
        })
    }
}

impl std::io::Read for GrowingFile {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            let n = self.file.read(buf)?;
            if n > 0 {
                return Ok(n);
            }
            // Sona geldik. Yazım bittiyse GERÇEK EOF; bitmediyse veri bekle.
            // ⚠️ Bittiğinde bir kez daha okunuyor: yazıcı son bloğu tam bu
            // sırada yazmış olabilir (yarış durumu).
            if self.done.load(std::sync::atomic::Ordering::Relaxed) {
                return self.file.read(buf);
            }
            // Bekleme ses callback'ini bloklar; kısa tut ki kesinti duyulmasın.
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
    }
}

impl std::io::Seek for GrowingFile {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.file.seek(pos)
    }
}

/// İndirmeyi ffmpeg'e boru ile bağlar; çalınabilir hâle gelince döner.
///
/// `ffmpeg_cmd`: çağıran taraf hazır bir Command verir (yol çözümü ve
/// Windows'ta konsol penceresi bastırma ytdlp.rs'in işi).
pub fn stream_to_adts(
    src: AudioSource,
    dest: std::path::PathBuf,
    mut ffmpeg_cmd: std::process::Command,
) -> Result<StreamHandle> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let _ = std::fs::remove_file(&dest);
    let mut child = ffmpeg_cmd
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-i",
            "pipe:0",
            "-vn",
            "-c:a",
            "copy",
            "-f",
            "adts",
            "-y",
            dest.to_str().unwrap_or_default(),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("ffmpeg borusu açılamadı"))?;

    let done = Arc::new(AtomicBool::new(false));
    let done_w = done.clone();
    let failed = Arc::new(AtomicBool::new(false));
    let failed_w = failed.clone();
    let dest_w = dest.clone(); // thread kendi kopyasını alır

    // İndirme + besleme thread'i.
    std::thread::spawn(move || {
        let result = (|| -> Result<()> {
            let c = http()?;
            let mut have: u64 = 0;
            while have < src.content_length {
                let end = (have + CHUNK - 1).min(src.content_length - 1);
                let bytes = fetch_chunk(&c, &src, have, end)?;
                if bytes.is_empty() {
                    anyhow::bail!("boş parça");
                }
                stdin.write_all(&bytes)?;
                have += bytes.len() as u64;
            }
            stdin.flush()?;
            Ok(())
        })();
        // Boruyu kapat → ffmpeg çıktıyı sonlandırır.
        drop(stdin);
        let ok = result.is_ok() && child.wait().map(|s| s.success()).unwrap_or(false);
        if let Err(e) = &result {
            log::warn!("akışlı indirme yarıda kaldı: {e}");
        }
        if !ok {
            failed_w.store(true, Ordering::Relaxed);
        }
        // ⭐ Tamamlandıysa nihai ada KOPYALA → bir dahaki sefere normal
        // (anında) yoldan çalınır. Taşıma değil: dosya hâlâ açık olabilir.
        if ok {
            if let Some(stem) = dest_w.file_name().and_then(|f| f.to_str()) {
                if let Some(id) = stem.strip_suffix(".stream.aac") {
                    let final_path = dest_w.with_file_name(format!("{id}.aac"));
                    // ⚠️ Zaten varsa DOKUNMA: akış zaman aşımına uğrayıp normal
                    // yola düşüldüyse aynı dosyayı `ensure_audio` da yazmış
                    // olabilir ve ses motoru onu AÇMIŞ olabilir. Windows'ta
                    // açık dosyanın üzerine kopyalamak başarısız olur.
                    if final_path.exists() {
                        log::debug!("akış çıktısı zaten önbellekte: {id}");
                    } else if let Err(e) = std::fs::copy(&dest_w, &final_path) {
                        log::warn!("akış dosyası önbelleğe alınamadı: {e}");
                    }
                }
            }
        }
        done_w.store(true, Ordering::Relaxed);
    });

    // Çalmaya yetecek kadar çıktı birikene kadar bekle.
    let t0 = std::time::Instant::now();
    loop {
        let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        if size >= MIN_START_BYTES {
            return Ok(StreamHandle {
                path: dest,
                done,
                failed,
            });
        }
        if done.load(Ordering::Relaxed) {
            // Yazım bitti: dosya küçük olsa da (kısa şarkı) çalınabilir.
            if size > 0 {
                return Ok(StreamHandle {
                    path: dest,
                    done,
                    failed,
                });
            }
            anyhow::bail!("akış başlatılamadı (çıktı yok)");
        }
        if t0.elapsed() > START_TIMEOUT {
            anyhow::bail!("akış zaman aşımı");
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
}

/// Tam yol: URL çöz + indir. Başarılıysa indirilen dosyanın yolunu döndürür.
pub fn fetch(cache_dir: &Path, video_id: &str, prefer_low: bool) -> Result<std::path::PathBuf> {
    if !native_enabled() {
        return Err(anyhow!("yerel çözüm geçici olarak askıda"));
    }
    let src = resolve_innertube(video_id, prefer_low)?;
    // ⭐ Boşa 1 MB indirme: adres kısıtlıysa ŞİMDİ anla (bkz. probe_url).
    if !probe_url(&src) {
        note_native_failure();
        return Err(anyhow!("adres kısıtlı (sağlık testi)"));
    }
    let dest = cache_dir.join(format!("{video_id}.src.m4a"));
    let n = match download_ranged(&src, &dest) {
        Ok(n) => {
            note_native_success();
            n
        }
        Err(e) => {
            note_native_failure();
            // Mühür kalırsa bir sonraki (farklı kaynaklı) indirme onu yanlışlıkla
            // "aynı kaynak" sanıp yarım dosyadan devam edebilir.
            let _ = std::fs::remove_file(dest.with_extension("part.meta"));
            return Err(e);
        }
    };
    log::info!(
        "yerel indirici tamam {video_id}: {} bayt ({})",
        n,
        src.via
    );
    Ok(dest)
}

/// yt-dlp'nin ÇÖZDÜĞÜ URL'yi yerel indiriciyle çek (ikinci katman).
/// URL çözümü yt-dlp'de kalır (imza/nsig/POT), baytları biz indiririz.
pub fn fetch_with_url(
    cache_dir: &Path,
    video_id: &str,
    url: &str,
    user_agent: &str,
    content_length: u64,
) -> Result<std::path::PathBuf> {
    let src = AudioSource {
        url: url.to_string(),
        user_agent: user_agent.to_string(),
        content_length,
        via: "yt-dlp-url".into(),
    };
    if !probe_url(&src) {
        return Err(anyhow!("adres kısıtlı/eskimiş (sağlık testi)"));
    }
    let dest = cache_dir.join(format!("{video_id}.src.m4a"));
    let n = download_ranged(&src, &dest)?;
    log::info!("yerel indirici (yt-dlp URL) tamam {video_id}: {n} bayt");
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SAĞLIK TESTİ regresyonu (ağ ister):
    ///   cargo test --lib probe -- --ignored --nocapture
    ///
    /// InnerTube adresi PO Token olmadan yalnız ilk ~1 MB'ı veriyor; bu testin
    /// yakaladığı şey, o adresi İNDİRMEDEN önce ayırt edebildiğimiz.
    /// Ayrım kaybolursa akış yolu şarkının ortasında susar (v1.8.5 bug'ı).
    #[test]
    #[ignore]
    fn probe_detects_restricted_url() {
        let vid = "cuMuMnCRfqk";
        let restricted = resolve_innertube(vid, false).expect("innertube adresi yok");
        let ok_restricted = probe_url(&restricted);
        println!("innertube adresi sağlıklı mı: {ok_restricted}");

        // yt-dlp'nin çözdüğü adres kısıtsız olmalı.
        let out = std::process::Command::new("yt-dlp")
            .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
            .args([
                "--extractor-args",
                "youtube:player_client=web_embedded",
                "-j",
                "-f",
                "bestaudio[ext=m4a]/bestaudio/best",
                "--no-playlist",
                "--no-warnings",
                "--",
                vid,
            ])
            .output()
            .expect("yt-dlp yok");
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).expect("json");
        let full = AudioSource {
            url: v["url"].as_str().expect("url").to_string(),
            user_agent: v["http_headers"]["User-Agent"]
                .as_str()
                .unwrap_or("Mozilla/5.0")
                .to_string(),
            content_length: v["filesize"]
                .as_u64()
                .or_else(|| v["filesize_approx"].as_u64())
                .expect("boyut"),
            via: "yt-dlp".into(),
        };
        let ok_full = probe_url(&full);
        println!("yt-dlp adresi sağlıklı mı: {ok_full}");
        assert!(ok_full, "kısıtsız adres sağlıksız göründü — test yanlış eler");
    }

    /// ⭐ KOPAN AKIŞ, BİTMİŞ AKIŞTAN AYIRT EDİLİYOR MU? (ağ ister)
    ///   cargo test --lib broken_stream -- --ignored --nocapture
    ///
    /// Kullanıcının bildirdiği "şarkı 35-40. saniyede kendiliğinden atlıyor"
    /// bug'ının kalbi: kısıtlı adres ~1 MB sonra 403 alıyor, dosya eksik
    /// kalıyor ve ses motoru bunu "şarkı bitti" sanıyordu. `failed` bayrağı
    /// bu iki durumu ayırt eder; ayrım kaybolursa bug geri gelir.
    #[test]
    #[ignore]
    fn broken_stream_is_marked_failed() {
        let dir = std::env::temp_dir().join("resonance-broken-test");
        let _ = std::fs::create_dir_all(&dir);
        let vid = "cuMuMnCRfqk";

        // Kısıtlı adres (InnerTube, PO Token yok) — sağlık testini BİLEREK
        // atlıyoruz ki kopma senaryosu gerçekleşsin.
        let src = resolve_innertube(vid, false).expect("innertube adresi yok");
        assert!(!probe_url(&src), "adres kısıtlı değil — test anlamsız");

        let dest = dir.join(format!("{vid}.stream.aac"));
        let mut cmd = std::process::Command::new("ffmpeg");
        cmd.env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
        let h = stream_to_adts(src, dest, cmd).expect("akış başlamalıydı");

        for _ in 0..600 {
            if h.done.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let done = h.done.load(std::sync::atomic::Ordering::Relaxed);
        let failed = h.failed.load(std::sync::atomic::Ordering::Relaxed);
        println!("done={done} failed={failed}");
        assert!(done, "akış bitmedi");
        assert!(
            failed,
            "KOPAN akış 'başarılı' göründü → ses motoru bunu şarkı bitişi              sanar ve parçayı atlar (35-40 sn bug'ı)"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// İNDİRİRKEN ÇALMA uçtan uca testi (ağ + ffmpeg ister):
    ///   cargo test --lib progressive -- --ignored --nocapture
    ///
    /// Doğruladığı şey sadece "dosya indi" değil, asıl kritik soru:
    /// YARIM dosya rodio/symphonia ile ÇÖZÜLEBİLİYOR mu?
    #[test]
    #[ignore]
    fn progressive_stream_plays() {
        let dir = std::env::temp_dir().join("resonance-stream-test");
        let _ = std::fs::create_dir_all(&dir);
        let vid = "cuMuMnCRfqk";

        // ⚠️ InnerTube adresi BİLEREK kullanılmıyor: 1 MB'da 403 alıyor ve
        // akışta bu "şarkı ortasında sesin kesilmesi" demek (bu testin ilk
        // çalıştırmasında tam olarak bu yakalandı). Gerçek akış yolu da
        // yalnız yt-dlp'nin çözdüğü kısıtsız adresi kullanıyor.
        let out = std::process::Command::new("yt-dlp")
            .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
            .args([
                "--extractor-args",
                "youtube:player_client=web_embedded",
                "-j",
                "-f",
                "bestaudio[ext=m4a]/bestaudio/best",
                "--no-playlist",
                "--no-warnings",
                "--",
                vid,
            ])
            .output()
            .expect("yt-dlp çalıştırılamadı");
        let v: serde_json::Value =
            serde_json::from_slice(&out.stdout).expect("yt-dlp JSON okunamadı");
        let src = AudioSource {
            url: v["url"].as_str().expect("url yok").to_string(),
            user_agent: v["http_headers"]["User-Agent"]
                .as_str()
                .unwrap_or("Mozilla/5.0")
                .to_string(),
            content_length: v["filesize"]
                .as_u64()
                .or_else(|| v["filesize_approx"].as_u64())
                .expect("boyut yok"),
            via: "yt-dlp".into(),
        };
        println!("adres: {} ({} bayt)", src.via, src.content_length);

        let dest = dir.join(format!("{vid}.stream.aac"));
        let mut cmd = std::process::Command::new("ffmpeg");
        cmd.env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
        let t0 = std::time::Instant::now();
        let h = stream_to_adts(src, dest.clone(), cmd).expect("akış başlatılamadı");
        let first = t0.elapsed().as_secs_f32();
        let size_at_start = std::fs::metadata(&h.path).map(|m| m.len()).unwrap_or(0);
        println!("ilk ses: {first:.2} sn, o anki dosya: {size_at_start} bayt");
        assert!(size_at_start >= MIN_START_BYTES / 2, "çok az veri");

        // ⭐ ASIL TEST: yarım dosyayı ses motorunun okuduğu gibi çöz.
        let reader = GrowingFile::open(&h.path, h.done.clone()).expect("okuyucu");
        let dec = rodio::Decoder::new(std::io::BufReader::new(reader));
        assert!(dec.is_ok(), "yarım ADTS çözülemedi: {:?}", dec.err());
        println!("çözümleme: TAMAM (yarım dosyadan)");

        // Yazım bitene kadar bekle, sonra bütünlüğü kontrol et.
        for _ in 0..600 {
            if h.done.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let final_size = std::fs::metadata(&h.path).map(|m| m.len()).unwrap_or(0);
        println!("bitti: {final_size} bayt, toplam {:.2} sn", t0.elapsed().as_secs_f32());
        assert!(final_size > size_at_start, "dosya büyümedi");

        // Tamamlanınca nihai ada kopyalanmalı (bir dahaki sefere anında çalsın).
        let cached = dir.join(format!("{vid}.aac"));
        assert!(cached.exists(), "önbelleğe kopyalanmadı");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
