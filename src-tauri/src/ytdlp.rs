// yt-dlp sarmalayıcı: YouTube arama + ses indirme.
// Ses, symphonia'nın güvenilir çözebildiği m4a/AAC olarak indirilir
// (gerekirse ffmpeg ile bir kez remux/transcode edilir) ve cache'lenir.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use crate::native_dl;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, OnceLock};

// Aynı video_id için eşzamanlı ensure_audio çağrılarını SERİLEŞTİRİR. Play +
// prefetch + radyo besleme aynı şarkıyı aynı anda indirmeye kalkınca aynı
// .src dosyasına yazıp birbirini bozuyordu (HTTP 416, "no such file",
// "invalid data"). Video başına tek kilit → ilk indirir, diğerleri bekleyip
// hazır dosyayı bulur.
fn inflight_lock(video_id: &str) -> Arc<Mutex<()>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let map = MAP.get_or_init(|| Mutex::new(HashMap::new()));
    // ⚠️ `unwrap()` DEĞİL: kilit tutulurken bir indirme panikleyince mutex
    // zehirlenir ve sonraki HER indirme panikle ölürdü. Zehirlenmiş kilidi
    // olduğu gibi kullanıyoruz (koruduğu veri sadece bir HashMap).
    let mut m = match map.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    m.entry(video_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// Windows'ta alt süreçler (yt-dlp/ffmpeg) varsayılan olarak bir konsol penceresi
// açar; arama/çalma/prefetch çok kez çağrıldığı için ekrana üst üste pencere
// fırlar. CREATE_NO_WINDOW bunu bastırır.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// Komutu Windows'ta konsol penceresi açmayacak şekilde işaretler (no-op değil
// platformlarda).
#[cfg(windows)]
fn no_window(c: &mut Command) {
    c.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn no_window(_c: &mut Command) {}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,        // "youtube:VIDEOID"
    pub source: String,    // "youtube"
    pub source_id: String, // VIDEOID
    pub title: String,
    pub artist: String,
    pub duration_ms: u64,
    pub thumbnail: Option<String>,
}

// macOS/Linux GUI uygulamaları (LaunchServices/`open` ile açılınca) kabuk
// PATH'ini miras almaz; yt-dlp ve ffmpeg genelde /opt/homebrew/bin veya
// /usr/local/bin'dedir. Komutun PATH'ini bu dizinlerle zenginleştiriyoruz —
// bu hem yt-dlp'yi bulur hem de yt-dlp'nin çağırdığı ffmpeg'i.
fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    // Yol ayracı platforma göre değişir (Windows ';', diğerleri ':').
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut extra: Vec<String> = Vec::new();
    // Sidecar dizini (uygulama exe'sinin yanı): gömülü yt-dlp, kendi
    // çağırdığı ffmpeg'i (DASH m4a FixupM4a için) PATH üzerinden de bulabilsin.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            extra.push(dir.to_string_lossy().into_owned());
        }
    }
    // macOS/Linux GUI uygulamaları kabuk PATH'ini miras almaz; Homebrew vb.
    // yaygın dizinleri ekle (Windows GUI uygulamaları sistem PATH'ini alır).
    #[cfg(not(windows))]
    {
        for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            extra.push(d.to_string());
        }
    }
    let prefix = extra.join(sep);
    match (prefix.is_empty(), current.is_empty()) {
        (true, _) => current,
        (false, true) => prefix,
        (false, false) => format!("{prefix}{sep}{current}"),
    }
}

// yt-dlp'ye verilecek ffmpeg yolu. YouTube ses akışları artık DASH m4a olduğu
// için yt-dlp indirdikten sonra container'ı ffmpeg ile düzeltir (FixupM4a).
// ffmpeg PATH'te yoksa (Windows: sistemde kurulu değil, sidecar yanında ama
// yt-dlp bilmiyor) ham/bozuk m4a yazar → çalma/dönüştürme başarısız olur.
// Sidecar/sistemdeki gerçek ffmpeg yolunu açıkça vererek bunu önlüyoruz.
fn ffmpeg_path() -> Option<PathBuf> {
    let p = PathBuf::from(resolve_bin("ffmpeg"));
    if p.is_absolute() && p.exists() {
        Some(p)
    } else {
        None
    }
}

// İkiliyi çöz. ÖNCE sistemde kurulu olanı tercih et — paketlenmiş yt-dlp
// (PyInstaller onefile) her çağrıda ~12sn açılırken sistemdeki ~1.7sn'de
// çalışıyor. Sistemde yoksa (temiz makine) uygulamaya gömülü sidecar'a düş →
// kurulum gerekmeden çalışmaya devam eder.
fn resolve_bin(name: &str) -> std::ffi::OsString {
    // 1) Sistemde kurulu mu? (hızlı)
    let exe_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ] {
        let p = Path::new(dir).join(&exe_name);
        if p.exists() {
            return p.into_os_string();
        }
    }
    // 1.5) Çalışma anında indirilen GÜNCEL ikili (app_data/bin). Gömülü sidecar
    // eskidiğinde (YouTube nsig/format değişiklikleri) onu geçersiz kılar.
    // Sidecar'dan ÖNCE denenir. Yol setup'ta RESONANCE_YTDLP_DIR ile verilir.
    if let Some(d) = std::env::var_os("RESONANCE_YTDLP_DIR") {
        let p = Path::new(&d).join(&exe_name);
        if p.exists() {
            return p.into_os_string();
        }
    }

    // 2) Uygulamaya gömülü sidecar (temiz makineler için).
    // Tauri sidecar'ı normalde triple'sız ("ffmpeg.exe") koyar; yine de garanti
    // olsun diye uygulama dizinini TARA ve triple'lı isimleri de
    // ("ffmpeg-x86_64-pc-windows-msvc.exe") yakala. İsimlendirme farkı yüzünden
    // ffmpeg/yt-dlp bulunamayıp indirme/çalmanın kırılmasını önler.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let direct = dir.join(&exe_name);
            if direct.exists() {
                return direct.into_os_string();
            }
            if let Ok(rd) = std::fs::read_dir(dir) {
                let want_exact = exe_name.to_lowercase();
                let want_prefix = format!("{name}-").to_lowercase();
                for e in rd.flatten() {
                    let fname = e.file_name().to_string_lossy().to_lowercase();
                    let is_match = fname == want_exact
                        || (fname.starts_with(&want_prefix)
                            && (!cfg!(windows) || fname.ends_with(".exe")));
                    if is_match && e.path().is_file() {
                        return e.path().into_os_string();
                    }
                }
            }
        }
    }
    // 3) PATH'e bırak
    std::ffi::OsString::from(name)
}

// cookies: kullanıcının Ayarlar'da seçtiği tarayıcı (ör. "safari", "chrome").
// Verilirse --cookies-from-browser eklenir → YouTube girişiyle tam playlist
// (>100 öğe) ve özel listelere erişim + bot engellerini azaltma.
fn yt_dlp(cookies: Option<&str>) -> Command {
    let mut c = Command::new(resolve_bin("yt-dlp"));
    c.env("PATH", augmented_path());
    no_window(&mut c);
    // ⚠️ Soket zaman aşımı: yt-dlp varsayılanda ölü bir bağlantıyı DAKİKALARCA
    // bekleyebiliyor. Bekleyen süreç `play_track`'i bloke ediyor, arayüz
    // "yükleniyor"da kilitleniyor ve oynat tuşu ölüyordu (Windows'ta sık).
    c.args(["--socket-timeout", "20"]);
    if let Some(b) = cookies {
        if !b.is_empty() {
            c.args(["--cookies-from-browser", &cookies_arg(b)]);
        }
    }
    c
}

// Tarayıcı seçimini yt-dlp'nin `--cookies-from-browser` argümanına çevirir.
// Opera GX ayrı bir profil dizininde durur; yt-dlp onu doğrudan tanımadığı için
// "opera:<profil-yolu>" biçiminde platforma göre yolu veriyoruz.
fn cookies_arg(browser: &str) -> String {
    if browser == "opera-gx" {
        #[cfg(windows)]
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return format!(
                "opera:{}\\Opera Software\\Opera GX Stable",
                appdata.to_string_lossy()
            );
        }
        #[cfg(target_os = "macos")]
        if let Some(home) = std::env::var_os("HOME") {
            return format!(
                "opera:{}/Library/Application Support/com.operasoftware.OperaGX",
                home.to_string_lossy()
            );
        }
        #[cfg(target_os = "linux")]
        if let Some(home) = std::env::var_os("HOME") {
            return format!("opera:{}/.config/opera-gx", home.to_string_lossy());
        }
        return "opera".to_string();
    }
    browser.to_string()
}

// yt-dlp çıktısının bir çerez bulma hatası olup olmadığını anlar (yanlış
// tarayıcı seçimi, eksik profil vb.). Böyle bir durumda çerezsiz tekrar
// denemek aramayı/indirmeyi tamamen kırmaktan iyidir.
fn is_cookie_error(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    s.contains("cookies") && (s.contains("could not find") || s.contains("could not copy"))
}

// yt-dlp'yi verilen argümanlarla çalıştırır. Çerez hatası alırsa çerezsiz bir
// kez daha dener — hatalı tarayıcı ayarı tüm işlemi kırmasın (yalnızca
// tam-playlist/özel-liste avantajı kaybolur).
/// Alt süreci çalıştırır ama SONSUZA KADAR BEKLEMEZ.
///
/// ⚠️ NEDEN VAR: `Command::output()` süreç bitene kadar bloklar. yt-dlp/ffmpeg
/// ağ takılmasında (Windows'ta çok daha sık) askıda kalabiliyor; o sırada
/// `play_track` hiç dönmüyor, frontend durumu "loading"de kalıyor ve
/// **oynat tuşu tamamen ölüyordu** — kullanıcının "Windows'ta play'e
/// basamıyorum" dediği tablo buydu. Süre dolunca süreç öldürülür ve normal
/// bir hata gibi ele alınır (bir sonraki katman devreye girer).
fn output_timeout(mut cmd: Command, secs: u64) -> std::io::Result<std::process::Output> {
    use std::io::Read;
    use std::process::Stdio;
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    // Boruları AYRI thread'lerde boşalt: dolu bir boru süreci kilitler.
    let mut so = child.stdout.take();
    let mut se = child.stderr.take();
    let t_out = std::thread::spawn(move || {
        let mut v = Vec::new();
        if let Some(s) = so.as_mut() {
            let _ = s.read_to_end(&mut v);
        }
        v
    });
    let t_err = std::thread::spawn(move || {
        let mut v = Vec::new();
        if let Some(s) = se.as_mut() {
            let _ = s.read_to_end(&mut v);
        }
        v
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(secs);
    let status = loop {
        match child.try_wait()? {
            Some(st) => break st,
            None => {
                if std::time::Instant::now() >= deadline {
                    log::warn!("alt süreç {secs} sn'de dönmedi, sonlandırılıyor");
                    let _ = child.kill();
                    break child.wait()?;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    };
    Ok(std::process::Output {
        status,
        stdout: t_out.join().unwrap_or_default(),
        stderr: t_err.join().unwrap_or_default(),
    })
}

fn run_yt_dlp(args: &[&str], cookies: Option<&str>) -> std::io::Result<std::process::Output> {
    run_yt_dlp_timeout(args, cookies, 120)
}

/// Bilgi/arama çağrıları 120 sn'de dönmeli; asıl BAYT İNDİRME yavaş bir
/// bağlantıda daha uzun sürebilir → çağıran süreyi seçer.
fn run_yt_dlp_timeout(
    args: &[&str],
    cookies: Option<&str>,
    secs: u64,
) -> std::io::Result<std::process::Output> {
    let mut c = yt_dlp(cookies);
    c.args(args);
    let out = output_timeout(c, secs)?;
    if cookies.is_some() && !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if is_cookie_error(&stderr) {
            let mut c2 = yt_dlp(None);
            c2.args(args);
            return output_timeout(c2, secs);
        }
    }
    Ok(out)
}

// Kalıcı (kurtarılamaz) YouTube hatası mı? Video silinmiş/özel/erişilemez ise
// ne çerez ne başka client kurtarır → boşuna tekrar denemeyip hemen vazgeç.
// DİKKAT: "requested format is not available" (aralıklı throttle) buraya
// GİRMEMELİ — o geçici, tekrar denenebilir.
fn is_permanent_error(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    s.contains("video unavailable")
        || s.contains("this video is not available")
        || s.contains("video is not available")
        || s.contains("private video")
        || s.contains("removed by the uploader")
        || s.contains("has been removed")
        || s.contains("no longer available")
        || s.contains("terminated")
        || s.contains("members-only")
        || s.contains("who has blocked it")
}

/// YouTube'da arama yapar ve düz (flat) sonuç listesi döndürür.
pub fn search(
    query: &str,
    limit: u32,
    _cookies: Option<&str>, // bilerek yok sayılır — aşağıdaki nota bakın
) -> anyhow::Result<Vec<SearchResult>> {
    // Aramada çerez KULLANMA: (1) her tuş vuruşunda tarayıcı çerez veritabanını
    // (yüzlerce çerez) okumak aramayı ciddi yavaşlatır; (2) giriş yapılmış çerez
    // YouTube'u "bot" moduna sokup yalnızca storyboard döndürebilir. Düz arama
    // (flat-playlist) zaten çerez gerektirmez.
    let spec = format!("ytsearch{}:{}", limit.max(1).min(50), query);
    let out = run_yt_dlp(
        &[
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            "--ignore-errors",
            &spec,
        ],
        None,
    )?;

    if out.stdout.is_empty() && !out.status.success() {
        anyhow::bail!(
            "yt-dlp arama başarısız: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }

    let mut results = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(r) = entry_to_result(&v) {
            // Aşırı uzun içerikleri (>1 saat: mix, livestream, podcast) ele —
            // bunlar şarkı değil. Süre bilinmiyorsa (0) tut.
            if r.duration_ms == 0 || r.duration_ms <= 3_600_000 {
                results.push(r);
            }
        }
    }
    Ok(results)
}

/// YouTube Music RADYOSU: bir video id'sinden "benzer şarkılar" listesi.
///
/// NEDEN: metin araması (`ytsearch:songs like X`) YouTube'a VİDEO sorar, şarkı
/// değil → röportaj, tepki videosu, "5 Things You Didn't Know", belgesel kesiti,
/// kısa film döner. Başlık sezgisiyle bunları ayıklamak mümkün değil (ör. "Meet
/// Dark R&B's Newest Darling" bir röportaj). Radyo listesi ise YouTube Music'in
/// KENDİ öneri motoru: yapısı gereği yalnız şarkı döner, üstelik süre + kanal
/// alanları dolu gelir (music.youtube.com ARAMASI'nın aksine — orada süre/sanatçı
/// boş gelir, o yüzden arama için kullanılamıyor).
///
/// Ölçüm (6 gerçek kütüphane parçası, limit=50): 6/6 radyo bulundu, ~2.9 sn,
/// 50 sonuç, 15-46 farklı sanatçı, süresi eksik 0.
///
/// Çerez KULLANILMAZ — arama ile aynı gerekçe (bkz. `search`).
/// YouTube MUSIC tür/ruh hali havuzu — Keşfet filtrelerinin KAYNAĞI.
///
/// ⭐ İKİ AŞAMALI, ÇÜNKÜ TEK AŞAMA ÇALIŞMIYOR (ölçüldü):
///  1. `music.youtube.com/search?q=…` VİDEO DÖNDÜRMEZ. Dönen id'ler playlist
///     (`VLRDCLAK5uy_…`), albüm (`MPREb_…`) ve kanal (`UC…`) kimlikleridir;
///     başlık/süre alanları BOŞ gelir. Bunları radyo tohumu sanıp
///     `watch?v=VLRDCLAK…` denemek sessizce BOŞ sonuç veriyordu → filtre hiç
///     çalışmıyor, Keşfet kişisel havuza düşüyordu ("türkçe seçtim tek türkçe
///     şarkı gelmedi" bug'ının kökü buydu).
///  2. Ama o `VL…` kimlikleri YouTube Music'in KENDİ KÜRATÖRLÜ tür/ruh hali
///     listeleridir. `VL` öneki atılıp `playlist?list=RDCLAK5uy_…` olarak
///     çekilince TAM metadata'lı gerçek şarkılar gelir (ölçüldü: "türkçe rock"
///     → mor ve ötesi, Dedublüman, Pinhâni…).
///
/// Yani: arama = liste bulma, asıl şarkılar listeden. Bu YouTube Music'in kendi
/// editör seçkisidir — jenerik metin aramasının getirdiği telifsiz stok müzik
/// sorunu da böylece kökten biter.
// Ses kalitesi tercihi ("high" | "low"). Frontend ayarı `set_audio_quality`
// ile buraya yazar; her indirme bunu okur. Global tutuluyor çünkü aksi halde
// play_track/prefetch/download komutlarının HEPSİNE parametre eklemek gerekirdi.
static AUDIO_QUALITY: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

pub fn set_audio_quality(q: &str) {
    if let Ok(mut g) = AUDIO_QUALITY.lock() {
        *g = q.to_string();
    }
}

fn audio_quality() -> String {
    AUDIO_QUALITY
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "high".to_string())
}

pub fn music_genre_pool(query: &str, limit: u32) -> anyhow::Result<Vec<SearchResult>> {
    let search_url = format!("https://music.youtube.com/search?q={}", urlencode(query));
    let out = run_yt_dlp(
        &[
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            "--ignore-errors",
            "--playlist-end",
            "25",
            &search_url,
        ],
        None,
    )?;

    // Aramadan yalnız ÇALMA LİSTESİ kimliklerini topla (VL öneki atılır).
    // Albüm (MPREb_) ve kanal (UC) kimlikleri bu yolla çekilemez, atlanır.
    let mut playlist_ids: Vec<String> = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
            if let Some(rest) = id.strip_prefix("VL") {
                if !rest.is_empty() && playlist_ids.len() < 3 {
                    playlist_ids.push(rest.to_string());
                }
            }
        }
    }
    if playlist_ids.is_empty() {
        return Ok(Vec::new());
    }

    // İlk 2 listeyi çek (tek liste tek editörün seçkisi; iki liste daha geniş
    // sanatçı yelpazesi verir — kullanıcının "hep aynı sanatçılar" şikâyeti).
    let end = limit.clamp(10, 100).to_string();
    let mut results = Vec::new();
    for pid in playlist_ids.iter().take(2) {
        let url = format!("https://music.youtube.com/playlist?list={pid}");
        let out = match run_yt_dlp(
            &[
                "--flat-playlist",
                "--dump-json",
                "--no-warnings",
                "--ignore-errors",
                "--playlist-end",
                &end,
                &url,
            ],
            None,
        ) {
            Ok(o) => o,
            Err(e) => {
                log::warn!("tür listesi çekilemedi {pid}: {e}");
                continue;
            }
        };
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let line = line.trim();
            if !line.starts_with('{') {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(r) = entry_to_result(&v) {
                    results.push(r);
                }
            }
        }
    }
    Ok(results)
}

/// Sorgu dizesini URL'e gömülebilir hâle getirir (yt-dlp'ye tam URL veriyoruz).
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn music_radio(video_id: &str, limit: u32) -> anyhow::Result<Vec<SearchResult>> {
    let url =
        format!("https://music.youtube.com/watch?v={video_id}&list=RDAMVM{video_id}");
    let end = limit.clamp(1, 100).to_string();
    let out = run_yt_dlp(
        &[
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            "--ignore-errors",
            "--playlist-end",
            &end,
            &url,
        ],
        None,
    )?;

    let mut results = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(r) = entry_to_result(&v) {
            results.push(r);
        }
    }
    // Radyosu olmayan/kaldırılmış video → boş liste (hata değil): çağıran taraf
    // başka bir seed'e ya da metin aramasına düşer.
    Ok(results)
}

// Tek bir flat-playlist/arama girdisini SearchResult'a çevirir.
fn entry_to_result(v: &serde_json::Value) -> Option<SearchResult> {
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or_default();
    if id.is_empty() {
        return None;
    }
    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .unwrap_or("Bilinmeyen")
        .to_string();
    let artist = v
        .get("uploader")
        .or_else(|| v.get("channel"))
        .or_else(|| v.get("artist"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let dur = v.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0);
    Some(SearchResult {
        id: format!("youtube:{id}"),
        source: "youtube".into(),
        source_id: id.to_string(),
        title,
        artist: clean_artist(&artist),
        duration_ms: (dur * 1000.0) as u64,
        thumbnail: Some(best_thumb(v, id)),
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistMeta {
    pub title: String,
    pub tracks: Vec<SearchResult>,
    pub total: u64, // listenin gerçek şarkı sayısı (yt-dlp playlist_count)
}

/// Bir YouTube / YouTube Music çalma listesi URL'inden başlık + şarkıları çıkarır.
pub fn playlist_meta(url: &str, cookies: Option<&str>) -> anyhow::Result<PlaylistMeta> {
    let out = run_yt_dlp(
        &[
            "--flat-playlist",
            "--dump-single-json",
            "--no-warnings",
            "--ignore-errors",
            url,
        ],
        cookies,
    )?;

    if out.stdout.is_empty() {
        anyhow::bail!(
            "Çalma listesi okunamadı: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }

    let v: serde_json::Value = serde_json::from_slice(&out.stdout)?;
    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .unwrap_or("İçe aktarılan liste")
        .to_string();

    let mut tracks = Vec::new();
    if let Some(entries) = v.get("entries").and_then(|e| e.as_array()) {
        for e in entries {
            if let Some(r) = entry_to_result(e) {
                tracks.push(r);
            }
        }
    }
    if tracks.is_empty() {
        anyhow::bail!("Bu bağlantıda şarkı bulunamadı (geçerli bir çalma listesi mi?)");
    }
    let total = v
        .get("playlist_count")
        .and_then(|x| x.as_u64())
        .unwrap_or(tracks.len() as u64);
    Ok(PlaylistMeta {
        title,
        tracks,
        total,
    })
}

fn ffmpeg() -> Command {
    let mut c = Command::new(resolve_bin("ffmpeg"));
    c.env("PATH", augmented_path());
    no_window(&mut c);
    c
}





/// ⭐ İNDİRİRKEN ÇALMA: adresi çöz, indirmeyi ffmpeg'e boru ile bağla ve
/// dosya çalınabilir hâle gelir gelmez dön (tamamlanmasını BEKLEMEZ).
///
/// Adres sırası `ensure_audio` ile aynı mantık: önbellek → InnerTube →
/// yt-dlp. Herhangi bir adımda takılırsa hata döner ve çağıran taraf normal
/// (indir → dönüştür → çal) yoluna düşer — yani bu yol yalnızca HIZLANDIRIR,
/// hiçbir zaman tek çare değildir.
pub fn stream_audio(
    cache_dir: &Path,
    video_id: &str,
    cookies: Option<&str>,
) -> anyhow::Result<native_dl::StreamHandle> {
    std::fs::create_dir_all(cache_dir)?;
    let low = audio_quality() == "low";

    // ⭐ BAĞLANTI SAĞLIKSIZSA AKIŞ YAPMA (v1.8.8). İndirirken çalma yalnız
    // indirme, çalmadan HIZLI olduğunda kazançlı; yavaş/kopan bağlantıda
    // okuyucu yazıcıya yetişiyor ve ses callback'i beklemek zorunda kalıyor →
    // CIZIRTI. Ölçülmüş sağlık verisi kötüyse normal yola düşüyoruz: ilk ses
    // biraz geç gelir ama TEMİZ gelir.
    let (mbps, fails, _) = native_dl::health();
    if fails > 0.25 || (mbps > 0.0 && mbps < 1.5) {
        anyhow::bail!("bağlantı akış için yavaş/dengesiz (mbps={mbps:.2}, hata={fails:.2})");
    }

    // "medium" yeniden kodlama istiyor (kaynakta 96k yok) → akış yolunda
    // `-c:a copy` kullanıldığı için bu kademe desteklenmez, normal yola bırak.
    if audio_quality() == "medium" {
        anyhow::bail!("orta kalite akışlı çalmayı desteklemiyor");
    }

    // ⛔ InnerTube adresi BU YOLDA KULLANILMAZ — ölçüldü (entegrasyon testi):
    // o adres PO Token olmadan 1 MB'da 403 veriyor. Normal indirmede bu yalnız
    // "bir katman düştü" demek, ama AKIŞTA şarkı ortasında SESİN KESİLMESİ
    // demektir. Akış yalnız kısıtsız adreslerle çalışır: önbellek (ısıtmadan,
    // yt-dlp kaynaklı) veya taze yt-dlp çözümü.
    let src = match native_dl::cached_source(video_id) {
        Some(s) => s,
        None => {
            {
                let url = format!("https://www.youtube.com/watch?v={video_id}");
                let fmt = if low {
                    "bestaudio[ext=m4a][abr<=70]/bestaudio[abr<=70]/bestaudio[ext=m4a]/bestaudio/best"
                } else {
                    "bestaudio[ext=m4a]/bestaudio/best[height<=480]/best"
                };
                let args: Vec<&str> = vec![
                    "-f", fmt, "--no-playlist", "--no-warnings", "--", &url,
                ];
                let (u, ua, len) = resolve_url_with_ytdlp(
                    &args,
                    Some("youtube:player_client=web_embedded"),
                    None,
                )
                .or_else(|| resolve_url_with_ytdlp(&args, None, None))
                .or_else(|| {
                    if cookies.map(|c| !c.is_empty()).unwrap_or(false) {
                        resolve_url_with_ytdlp(&args, None, cookies)
                    } else {
                        None
                    }
                })
                .ok_or_else(|| anyhow::anyhow!("akış için adres çözülemedi"))?;
                native_dl::cache_url(video_id, &u, &ua, len);
                native_dl::AudioSource {
                    url: u,
                    user_agent: ua,
                    content_length: len,
                    via: "yt-dlp".into(),
                }
            }
        }
    };

    // ⭐ AKIŞA GİRMEDEN ÖNCE ADRESİ DOĞRULA (v1.8.5).
    // Kısıtlı bir adresle akış başlatmak, şarkının ortasında sesin kesilmesi
    // demek: indirme 403 alınca dosya eksik kalıyor, ses motoru dosyanın
    // sonuna gelip "bitti" sanıyor ve sıradakine geçiyor. Normal indirmede
    // aynı durum yalnız "bir katman düştü" anlamına geldiği için zararsızdı.
    if !native_dl::probe_url(&src) {
        anyhow::bail!("akış için adres kısıtlı (sağlık testi)");
    }

    let dest = cache_dir.join(format!("{video_id}.stream.aac"));
    let t0 = std::time::Instant::now();
    let h = native_dl::stream_to_adts(src, dest, ffmpeg())?;
    log::info!(
        "akışlı çalma başladı {video_id}: ilk ses {:.2} sn",
        t0.elapsed().as_secs_f32()
    );
    Ok(h)
}


// ═══════════════════════════════════════════════════════════════════════════
// YEREL MÜZİK DOSYALARI (v1.8.3)
//
// Kullanıcının kendi arşivi: YouTube'da olmayan/kaldırılmış şarkılar, kendi
// kayıtları, satın aldıkları. İnternet gerekmez ve öneri motoru bunları da
// öğrenir (aynı `tracks` tablosuna `source='local'` olarak yazılırlar).
//
// ⚠️ ÇALINABİLİRLİK: rodio/symphonia mp3/flac/wav/ogg'yi doğrudan çözer ama
// m4a/aac/opus/wma'da ya panikler ya da hiç desteklemez (bkz. CLAUDE.md #1).
// Bu yüzden desteklenmeyen formatlar ffmpeg ile BİR KEZ ADTS'ye çevrilip
// önbelleğe konur; kaynak dosyaya DOKUNULMAZ.
// ═══════════════════════════════════════════════════════════════════════════

/// rodio'nun doğrudan çözebildiği uzantılar.
const NATIVE_PLAYABLE: [&str; 6] = ["mp3", "flac", "wav", "ogg", "oga", "aac"];
/// Taramada kabul edilen tüm ses uzantıları.
const AUDIO_EXTS: [&str; 10] = [
    "mp3", "flac", "wav", "ogg", "oga", "aac", "m4a", "opus", "wma", "aiff",
];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalTrack {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
}

fn ffprobe() -> Command {
    let mut c = Command::new(resolve_bin("ffprobe"));
    c.env("PATH", augmented_path());
    no_window(&mut c);
    c
}

/// Dosya/klasör listesini tarar, ses dosyalarının metadata'sını okur.
/// Klasörler ÖZYİNELEMELİ taranır (bir albüm klasörü tek seçimle gelsin).
pub fn scan_local(paths: &[String]) -> Vec<LocalTrack> {
    let mut files: Vec<PathBuf> = Vec::new();
    for p in paths {
        let path = PathBuf::from(p);
        if path.is_dir() {
            collect_audio(&path, &mut files, 0);
        } else if is_audio(&path) {
            files.push(path);
        }
    }
    files.sort();
    files.dedup();

    let mut out = Vec::new();
    for f in files.iter().take(2000) {
        if let Some(t) = probe_local(f) {
            out.push(t);
        }
    }
    log::info!("{} yerel ses dosyası içe aktarıldı", out.len());
    out
}

fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn collect_audio(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 6 {
        return; // saçma derinlikte taramayı kes
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_audio(&p, out, depth + 1);
        } else if is_audio(&p) {
            out.push(p);
        }
    }
}

/// ffmpeg çıktısından süreyi çıkar ("Duration: 00:03:45.12").
///
/// ⚠️ NEDEN GEREKLİ: `ffprobe` sidecar olarak PAKETLENMİYOR (yalnız yt-dlp ve
/// ffmpeg). macOS'ta Homebrew kurulu olduğu için fark edilmiyordu, ama temiz
/// bir Windows kurulumunda ffprobe YOK → yerel dosya içe aktarma çalışmazdı.
/// ffmpeg her zaman elimizde; süreyi ondan okuyoruz.
fn duration_via_ffmpeg(path: &Path) -> u64 {
    let mut c = ffmpeg();
    c.arg("-i").arg(path);
    let Ok(out) = output_timeout(c, 30) else {
        return 0;
    };
    let err = String::from_utf8_lossy(&out.stderr);
    let Some(i) = err.find("Duration:") else {
        return 0;
    };
    let rest = &err[i + 9..];
    let stamp: String = rest.trim_start().chars().take(11).collect();
    let mut parts = stamp.split(':');
    let h: f64 = parts.next().and_then(|x| x.trim().parse().ok()).unwrap_or(0.0);
    let m: f64 = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0.0);
    let sec: f64 = parts
        .next()
        .map(|x| x.trim_end_matches(',').to_string())
        .and_then(|x| x.parse().ok())
        .unwrap_or(0.0);
    ((h * 3600.0 + m * 60.0 + sec) * 1000.0) as u64
}

/// ffprobe ile başlık/sanatçı/süre. Etiket yoksa dosya adına düşülür.
/// ffprobe bulunamazsa süre ffmpeg'den okunur (bkz. duration_via_ffmpeg).
fn probe_local(path: &Path) -> Option<LocalTrack> {
    let probe = {
        let mut c = ffprobe();
        c.args(["-v", "quiet", "-print_format", "json", "-show_format", "--"])
            .arg(path);
        output_timeout(c, 30)
    }
        .ok()
        .filter(|o| o.status.success());

    let stem_only = probe.is_none();
    let v: serde_json::Value = probe
        .and_then(|o| serde_json::from_slice(&o.stdout).ok())
        .unwrap_or(serde_json::Value::Null);
    let tags = &v["format"]["tags"];
    let get = |k: &str, k2: &str| -> String {
        tags[k]
            .as_str()
            .or_else(|| tags[k2].as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let mut title = get("title", "TITLE");
    if title.is_empty() {
        title = stem.clone();
    }
    let artist = {
        let a = get("artist", "ARTIST");
        if a.is_empty() {
            // "Sanatçı - Şarkı.mp3" kalıbı yaygın; etiket yoksa oradan çıkar.
            stem.split(" - ").next().filter(|x| x.len() > 1 && stem.contains(" - "))
                .unwrap_or("")
                .to_string()
        } else {
            a
        }
    };
    let duration_ms = v["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .map(|d| (d * 1000.0) as u64)
        .unwrap_or_else(|| {
            // ffprobe yoksa/çalışmadıysa süreyi ffmpeg'den al.
            if stem_only {
                duration_via_ffmpeg(path)
            } else {
                0
            }
        });
    Some(LocalTrack {
        path: path.to_string_lossy().into_owned(),
        title,
        artist: get("album_artist", "ALBUM_ARTIST")
            .is_empty()
            .then(|| artist.clone())
            .unwrap_or_else(|| get("album_artist", "ALBUM_ARTIST")),
        album: get("album", "ALBUM"),
        duration_ms,
    })
}

/// Yerel dosyayı ÇALINABİLİR hâle getirir: rodio doğrudan çözebiliyorsa
/// dosyanın kendisi, çözemiyorsa önbellekteki ADTS kopyası döner.
pub fn ensure_local_audio(cache_dir: &Path, path: &str) -> anyhow::Result<PathBuf> {
    let src = PathBuf::from(path);
    if !src.exists() {
        anyhow::bail!("dosya bulunamadı: {path}");
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if NATIVE_PLAYABLE.contains(&ext.as_str()) {
        return Ok(src);
    }

    // Dönüştürülmüş kopya: yol karmasıyla adlandırılır (aynı ada sahip farklı
    // dosyalar çakışmasın).
    let mut hash: u64 = 1469598103934665603;
    for b in path.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    let target = cache_dir.join(format!("local-{hash:016x}.aac"));
    if target.exists() {
        return Ok(target);
    }
    std::fs::create_dir_all(cache_dir)?;
    // ⚠️ Yolları `to_str().unwrap()` ile geçirmek Windows'ta PANİK riski
    // (geçersiz UTF-8 yol). `arg()` OsStr aldığı için dönüşüme hiç gerek yok.
    let mut c = ffmpeg();
    c.args(["-y", "-v", "error", "-i"])
        .arg(path)
        .args(["-vn", "-c:a", "aac", "-b:a", "192k", "-f", "adts"])
        .arg(&target);
    let out = output_timeout(c, 180)?;
    if !out.status.success() || !target.exists() {
        anyhow::bail!(
            "yerel dosya dönüştürülemedi: {}",
            first_line(&String::from_utf8_lossy(&out.stderr))
        );
    }
    Ok(target)
}


/// ⭐ ALTERNATİF KAYNAK — "bu video inmiyorsa, aynı şarkının BAŞKA yüklemesi".
///
/// Bir video kaldırılmış, bölge kısıtlı ya da inatla 403 veriyor olabilir.
/// Şimdiye kadar bu durumda şarkı ATLANIYORDU — oysa YouTube'da aynı şarkının
/// onlarca yüklemesi var. Bu fonksiyon başlık+sanatçıyla arayıp SÜRESİ TUTAN
/// (±%20) bir alternatif bulur; çağıran taraf onu indirmeyi dener.
///
/// ⚠️ Süre kontrolü ŞART: aynı adı taşıyan başka bir şarkı, canlı kayıt ya da
/// 10 dakikalık bir "mix" gelmesin. `is_likely_song` filtresi de uygulanır.
pub fn find_alternative(
    title: &str,
    artist: &str,
    duration_ms: u64,
    exclude_id: &str,
    cookies: Option<&str>,
) -> Option<SearchResult> {
    let q = if artist.trim().is_empty() {
        title.to_string()
    } else {
        format!("{artist} {title}")
    };
    let results = search(&q, 8, cookies).ok()?;
    let mut best: Option<(u64, SearchResult)> = None;
    for r in results {
        if r.source_id == exclude_id {
            continue;
        }
        if !is_likely_song(&r.title, &r.artist, r.duration_ms) {
            continue;
        }
        // Süre yakınlığı: aynı şarkı olduğuna dair en güvenilir sinyal.
        if duration_ms > 0 && r.duration_ms > 0 {
            let diff = duration_ms.abs_diff(r.duration_ms);
            if diff * 5 > duration_ms {
                continue; // %20'den fazla sapma → başka bir kayıt
            }
            let score = diff;
            if best.as_ref().map(|(b, _)| score < *b).unwrap_or(true) {
                best = Some((score, r));
            }
        } else if best.is_none() {
            best = Some((u64::MAX, r));
        }
    }
    let (_, r) = best?;
    log::info!(
        "alternatif kaynak bulundu: {} → {} ({})",
        exclude_id,
        r.source_id,
        r.title
    );
    Some(r)
}

/// Öneri motorundaki `isLikelySong` filtresinin Rust karşılığı (dar sürüm):
/// alternatif ararken mix/podcast/uzun içerik gelmesin.
fn is_likely_song(title: &str, channel: &str, duration_ms: u64) -> bool {
    if duration_ms > 0 && (duration_ms < 40_000 || duration_ms > 9 * 60_000) {
        return false;
    }
    let t = title.to_lowercase();
    let c = channel.to_lowercase();
    const BAD: [&str; 10] = [
        "full album", "mix", "megamix", "compilation", "greatest hits",
        "podcast", "interview", "röportaj", "live stream", "canlı yayın",
    ];
    // Kelime sınırı olmadan kontrol RİSKLİ ("mix" → "Remix") → boşlukla sarmala.
    let padded = format!(" {t} ");
    for b in BAD {
        if padded.contains(&format!(" {b} ")) {
            return false;
        }
    }
    !c.contains("podcast")
}

/// ⭐ İNDİRME TEŞHİSİ — "neden çalmıyor?" sorusunu log okumadan yanıtlar.
///
/// Kullanıcının Windows'ta yaşadığı "hiçbir şarkı açılmıyor, sadece
/// indirdiklerim çalıyor" tablosunda tek teşhis yolu log dosyasıydı ve
/// arayüzde log ekranı yok. Bu fonksiyon zinciri gerçek bir videoyla
/// baştan sona dener ve HANGİ ADIMDA kırıldığını söyler.
pub fn diagnose(cache_dir: &Path, cookies: Option<&str>) -> String {
    let mut out = String::new();
    fn line(o: &mut String, k: &str, v: String) {
        o.push_str(&format!("{k}: {v}\n"));
    }

    let ytp = resolve_bin("yt-dlp");
    line(&mut out, "yt-dlp yolu", ytp.to_string_lossy().into_owned());
    let ver = {
        let mut c = yt_dlp(None);
        c.arg("--version");
        output_timeout(c, 20)
    }
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    line(
        &mut out,
        "yt-dlp sürümü",
        ver.clone().unwrap_or_else(|| "ÇALIŞTIRILAMADI".into()),
    );
    // ⚠️ ESKİ yt-dlp = YouTube tarafında sessiz kırılma. ÖLÇÜLDÜ: kullanıcının
    // Windows'unda ikili 10 HAFTA eskiydi (haftalık otomatik güncelleme
    // çalışan exe'yi değiştiremediği için sessizce başarısız oluyordu).
    // Panelde görünmediği sürece kimse fark etmiyor.
    let age_days = std::fs::metadata(&ytp)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.elapsed().ok())
        .map(|d| d.as_secs() / 86_400);
    line(
        &mut out,
        "yt-dlp yaşı",
        match age_days {
            Some(d) if d > 21 => format!("{d} gün — ESKİ, Ayarlar'dan güncelleyin"),
            Some(d) => format!("{d} gün"),
            None => "bilinmiyor".to_string(),
        },
    );
    let ff = ffmpeg_path();
    line(
        &mut out,
        "ffmpeg",
        ff.as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "BULUNAMADI".into()),
    );
    let ffok = {
        let mut c = ffmpeg();
        c.arg("-version");
        output_timeout(c, 20)
    }
        .map(|o| o.status.success())
        .unwrap_or(false);
    line(
        &mut out,
        "ffmpeg çalışıyor",
        if ffok { "evet".into() } else { "HAYIR".to_string() },
    );

    if ver.is_none() {
        out.push_str(
            "\nSONUÇ: yt-dlp çalıştırılamıyor. Ayarlar'dan yt-dlp güncellemesini              deneyin; sorun sürerse antivirüs/SmartScreen dosyayı engelliyor olabilir.\n",
        );
        return out;
    }

    const TEST_ID: &str = "dQw4w9WgXcQ";
    let t0 = std::time::Instant::now();

    // Hızı okunabilir yazan yardımcı: "3.3 MB / 1.2 sn (2.8 MB/sn)".
    fn speed(bytes: u64, secs: f32) -> String {
        let mb = bytes as f32 / 1_048_576.0;
        if secs <= 0.01 {
            return format!("{mb:.1} MB");
        }
        format!("{mb:.1} MB / {secs:.1} sn ({:.1} MB/sn)", mb / secs)
    }

    // ── KATMAN 1: kendi indiricimiz, adresi de KENDİMİZ çözüyoruz ──────────
    // (InnerTube). Bu yol yt-dlp süreci hiç başlatmaz — en hızlısı, ama
    // PO Token kısıtı yüzünden çoğu ağda baytlar 403 alır.
    let native = native_dl::resolve_innertube(TEST_ID, false);
    line(
        &mut out,
        "\nkatman 1 · kendi indirici (kendi adres çözümümüz)",
        match &native {
            Ok(s) => format!("adres tamam ({}, {} bayt)", s.via, s.content_length),
            Err(e) => format!("adres ÇÖZÜLEMEDİ — {e}"),
        },
    );
    let mut native_ok = false;
    if let Ok(src) = &native {
        let t = std::time::Instant::now();
        match native_dl::fetch_with_url(
            cache_dir,
            "diag_native",
            &src.url,
            &src.user_agent,
            src.content_length,
        ) {
            Ok(p) => {
                native_ok = true;
                let sz = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                line(
                    &mut out,
                    "  └ indirme",
                    format!("tamam — {}", speed(sz, t.elapsed().as_secs_f32())),
                );
                let _ = std::fs::remove_file(&p);
            }
            Err(e) => line(&mut out, "  └ indirme", format!("BAŞARISIZ — {e}")),
        }
    }

    // ── KATMAN 2: adresi yt-dlp çözer, baytları BİZ indiririz ─────────────
    // Pratikte kurtaran yol genelde bu.
    let base = format!("https://www.youtube.com/watch?v={TEST_ID}");
    let args: Vec<&str> = vec![
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "--no-playlist",
        "--no-warnings",
        "--",
        &base,
    ];
    let t_res = std::time::Instant::now();
    let resolved = resolve_url_with_ytdlp(&args, Some("youtube:player_client=web_embedded"), None)
        .or_else(|| resolve_url_with_ytdlp(&args, None, None))
        .or_else(|| {
            if cookies.map(|c| !c.is_empty()).unwrap_or(false) {
                resolve_url_with_ytdlp(&args, None, cookies)
            } else {
                None
            }
        });
    line(
        &mut out,
        "katman 2 · kendi indirici (yt-dlp adres çözümü)",
        match &resolved {
            Some((_, _, len)) => format!(
                "adres tamam ({len} bayt, {:.1} sn)",
                t_res.elapsed().as_secs_f32()
            ),
            None => "adres ÇÖZÜLEMEDİ".to_string(),
        },
    );

    let mut downloaded = false;
    if let Some((u, ua, len)) = &resolved {
        let t = std::time::Instant::now();
        match native_dl::fetch_with_url(cache_dir, "diag", u, ua, *len) {
            Ok(p) => {
                downloaded = true;
                let sz = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                line(
                    &mut out,
                    "  └ indirme",
                    format!("tamam — {}", speed(sz, t.elapsed().as_secs_f32())),
                );
                let _ = std::fs::remove_file(&p);
            }
            Err(e) => line(&mut out, "  └ indirme", format!("BAŞARISIZ — {e}")),
        }
    }

    // ── KATMAN 3 + ffmpeg: uygulamanın GERÇEK yolu ────────────────────────
    // ⭐ ASIL SORU BU: "bu bilgisayar bir şarkıyı ÇALINABİLİR hâle getirebiliyor
    // mu?" Üstteki katmanlar başarısız olsa bile uygulama yt-dlp'nin kendi
    // indirmesine düşüp şarkıyı çalabiliyor. Eski panel bunu hiç denemeden
    // "baytlar indirilemiyor" diyip kullanıcıyı güvenlik duvarı aramaya
    // yolluyordu.
    let _ = std::fs::remove_file(cache_dir.join(format!("{TEST_ID}.aac")));
    let t_full = std::time::Instant::now();
    let full_chain = ensure_audio(cache_dir, TEST_ID, cookies);
    line(
        &mut out,
        "tam zincir (tüm katmanlar + ffmpeg)",
        match &full_chain {
            Ok(p) => {
                let sz = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
                format!("tamam — {}", speed(sz, t_full.elapsed().as_secs_f32()))
            }
            Err(e) => format!("BAŞARISIZ — {e}"),
        },
    );
    if let Ok(p) = &full_chain {
        let _ = std::fs::remove_file(p);
    }
    let playable = full_chain.is_ok();

    line(
        &mut out,
        "toplam süre",
        format!("{:.1} sn", t0.elapsed().as_secs_f32()),
    );

    out.push_str("\nSONUÇ: ");
    if playable && native_ok {
        out.push_str(
            "her şey çalışıyor ve EN HIZLI yol (kendi indiricimiz, kendi adres çözümümüz)              da açık — şarkılar en kısa sürede başlıyor.\n",
        );
        return out;
    }
    out.push_str(match (playable, downloaded, resolved.is_some(), ffok) {
        (true, true, _, _) => {
            "her şey çalışıyor. Bir şarkı yine de açılmıyorsa sorun bu bilgisayarda değil;              o şarkı kısıtlı/kaldırılmış olabilir."
        }
        (true, false, _, _) => {
            "şarkılar İNİYOR ama hızlı yol (kendi indiricimiz) bu ağda engelli →              her şarkı birkaç saniye daha geç başlar. Çalmayı engelleyen bir şey yok."
        }
        (false, _, _, false) => {
            "ffmpeg yok/çalışmıyor → ses dönüştürme başarısız oluyor.              Uygulamayı yeniden kurmak genelde çözer."
        }
        (false, _, true, true) => {
            "adres çözülüyor ama HİÇBİR yolla bayt indirilemiyor. Genelde güvenlik              duvarı/antivirüs bu uygulamayı engelliyor ya da YouTube hız sınırı var;              birkaç dakika sonra tekrar deneyin."
        }
        (false, _, false, _) => {
            "yt-dlp adresi çözemiyor. En olası sebep ESKİ yt-dlp — Ayarlar'dan yt-dlp'yi              güncelleyin."
        }
    });
    out.push('\n');
    out
}

/// ⭐ TOPLU URL ÇÖZÜMÜ — sıradaki şarkıların adreslerini ÖNDEN çöz.
///
/// ÖLÇÜM (2026-08-19, 4 video): ayrı ayrı 9.98 sn (2.50 sn/video), TEK
/// yt-dlp çağrısıyla 7.63 sn (1.91 sn/video) → 1.3×. Asıl kazanç ise
/// zamanlamada: iş ARKA PLANDA yapıldığı için kullanıcı ileri atladığında
/// şarkı başına ~2.5 sn'lik çözüm beklemesi tamamen ortadan kalkar.
///
/// Sonuçlar `native_dl` URL önbelleğine yazılır; dosya İNDİRİLMEZ.
pub fn prewarm_urls(video_ids: &[String], cookies: Option<&str>) {
    if video_ids.is_empty() {
        return;
    }
    let fmt = if audio_quality() == "low" {
        "bestaudio[ext=m4a][abr<=70]/bestaudio[abr<=70]/bestaudio[ext=m4a]/bestaudio/best"
    } else {
        "bestaudio[ext=m4a]/bestaudio/best[height<=480]/best"
    };
    // ⭐ Zaten önbellekte adresi olanları TEKRAR çözme. `prefetchNext` her
    // şarkı yüklemesinde ısıtma çağırıyor; süzmezsek aynı 8 şarkı için
    // defalarca yt-dlp çalıştırılırdı (her tur ~16 sn boşa iş).
    let pending: Vec<&String> = video_ids
        .iter()
        .filter(|v| native_dl::cached_source(v).is_none())
        .collect();
    if pending.is_empty() {
        return;
    }
    let urls: Vec<String> = pending
        .iter()
        .map(|v| format!("https://www.youtube.com/watch?v={v}"))
        .collect();
    let mut args: Vec<&str> = vec![
        "--extractor-args",
        "youtube:player_client=web_embedded",
        "-j",
        "-f",
        fmt,
        "--no-playlist",
        "--no-warnings",
        "--",
    ];
    for u in &urls {
        args.push(u);
    }

    log::info!("adres ısıtma başlıyor: {} şarkı", pending.len());
    let out = match run_yt_dlp(&args, cookies) {
        Ok(o) => o,
        Err(e) => {
            log::warn!("adres ısıtma çalıştırılamadı: {e}");
            return;
        }
    };
    if !out.status.success() {
        log::warn!(
            "adres ısıtma başarısız: {}",
            first_line(&String::from_utf8_lossy(&out.stderr))
        );
    }
    // `-j` her video için AYRI bir JSON satırı yazar.
    let text = String::from_utf8_lossy(&out.stdout);
    let mut n = 0;
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let (Some(id), Some(url)) = (v["id"].as_str(), v["url"].as_str()) else {
            continue;
        };
        let len = v["filesize"]
            .as_u64()
            .or_else(|| v["filesize_approx"].as_u64())
            .unwrap_or(0);
        if len == 0 {
            continue;
        }
        let ua = v["http_headers"]["User-Agent"]
            .as_str()
            .unwrap_or("Mozilla/5.0");
        native_dl::cache_url(id, url, ua, len);
        n += 1;
    }
    if n > 0 {
        log::info!(
            "{n} şarkının adresi önden çözüldü (önbellek: {})",
            native_dl::cached_count()
        );
    }
}

/// yt-dlp'yi YALNIZ URL ÇÖZÜCÜ olarak kullan (`-j`): indirme yapmaz, seçilen
/// formatın gerçek CDN adresini + gerekli User-Agent'ı verir.
///
/// ⭐ NEDEN: ölçüldü (2026-08-19) — yt-dlp'nin çözdüğü URL'ye elle `Range`
/// istekleri atınca tüm parçalar 206/200 dönüyor. Yani duvar URL ÇÖZÜMÜNDE;
/// baytları çekmek serbest. URL'yi alıp indirmeyi kendi indiricimize
/// (native_dl) vermek, yt-dlp'nin indirme katmanındaki 403 davranışını ve
/// yarıda kopunca baştan başlama sorununu tamamen devre dışı bırakır.
fn resolve_url_with_ytdlp(
    base_args: &[&str],
    extra: Option<&str>,
    cookies: Option<&str>,
) -> Option<(String, String, u64)> {
    // ⚠️ `-j` MUTLAKA `--`'den ÖNCE gelmeli: base_args `… -- <url>` ile bitiyor
    // ve `--` sonrasındaki her şey POZİSYONEL argüman sayılır. (Bu hata bir kez
    // yapıldı: katman 2 sessizce hiç çalışmadı.)
    let mut a: Vec<&str> = Vec::new();
    if let Some(e) = extra {
        a.push("--extractor-args");
        a.push(e);
    }
    a.push("-j");
    a.extend_from_slice(base_args);
    let out = run_yt_dlp(&a, cookies).ok()?;
    if !out.status.success() {
        log::info!(
            "URL çözümü başarısız ({}): {}",
            extra.unwrap_or("default"),
            first_line(&String::from_utf8_lossy(&out.stderr))
        );
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let url = v["url"].as_str()?.to_string();
    let len = v["filesize"]
        .as_u64()
        .or_else(|| v["filesize_approx"].as_u64())
        .unwrap_or(0);
    if len == 0 {
        return None; // boyut bilinmeden parçalı indirme yapılamaz
    }
    let ua = v["http_headers"]["User-Agent"]
        .as_str()
        .unwrap_or("Mozilla/5.0")
        .to_string();
    Some((url, ua, len))
}

/// Ses dosyasının ENTEGRE YÜKSEKLİĞİNİ (LUFS) ve tepe seviyesini (dBTP) ölçer.
///
/// Neden gerekiyor: kaynaklar YouTube'dan geldiği için parçalar arası seviye
/// farkı çok büyük (bir şarkı patlıyor, diğeri fısıldıyor). Ölçüm bir kez
/// yapılır, sonuç DB'ye yazılır ve çalarken kazanç olarak uygulanır.
///
/// ⚠️ `loudnorm` ANALİZ modu (print_format=json) kullanılıyor, `ebur128`
/// özet metni DEĞİL: ebur128 çıktısında "Peak:" satırı sürüme göre birden çok
/// bölümde (sample peak / true peak) geçiyor → sessizce yanlış değer
/// ayrıştırma riski var. JSON'da böyle bir belirsizlik yok.
///
/// Maliyet: tam dosya taranır, 3-4 dakikalık parçada ~1-2 sn (tek çekirdek).
pub fn measure_loudness(cache_dir: &Path, video_id: &str) -> anyhow::Result<(f64, f64)> {
    let path = find_cached(cache_dir, video_id)
        .ok_or_else(|| anyhow::anyhow!("dosya önbellekte yok ({video_id})"))?;
    let mut c = ffmpeg();
    c.args(["-hide_banner", "-nostats", "-i"])
        .arg(&path)
        .args(["-af", "loudnorm=print_format=json", "-f", "null", "-"]);
    let out = output_timeout(c, 120)?;

    // JSON bloğu stderr'in SONUNDADIR (ffmpeg'in kendi logları önce gelir).
    let err = String::from_utf8_lossy(&out.stderr);
    let start = err
        .rfind('{')
        .ok_or_else(|| anyhow::anyhow!("loudnorm çıktısı okunamadı"))?;
    let end = err
        .rfind('}')
        .ok_or_else(|| anyhow::anyhow!("loudnorm çıktısı okunamadı"))?;
    if end <= start {
        anyhow::bail!("loudnorm çıktısı bozuk");
    }
    let v: serde_json::Value = serde_json::from_str(&err[start..=end])?;
    let num = |k: &str| -> Option<f64> { v.get(k)?.as_str()?.parse::<f64>().ok() };

    let lufs = num("input_i").ok_or_else(|| anyhow::anyhow!("input_i yok"))?;
    // Sessiz/bozuk dosyada loudnorm "-inf" döndürür → kazanç hesabı çökerdi.
    if !lufs.is_finite() || !(-70.0..=5.0).contains(&lufs) {
        anyhow::bail!("ölçüm anlamsız (I={lufs})");
    }
    let peak = num("input_tp").filter(|p| p.is_finite()).unwrap_or(0.0);
    Ok((lufs, peak))
}


/// En son başarılı indirme yolu (STRATEGIES indeksi). Bkz. ensure_audio.
static LAST_GOOD_STRATEGY: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// Log'u şişirmemek için hata çıktısının ilk anlamlı satırı.
fn first_line(s: &str) -> String {
    s.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(160)
        .collect()
}

// İndirilen geçici kaynak dosyasını (<id>.src.<ext>) bulur.
fn find_src(cache_dir: &Path, video_id: &str) -> Option<PathBuf> {
    let prefix = format!("{video_id}.src.");
    for e in std::fs::read_dir(cache_dir).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.starts_with(&prefix) {
            continue;
        }
        // ⚠️ YARIM/YARDIMCI DOSYALARI ASLA KAYNAK SAYMA. Yerel indirici
        // `<id>.src.part` (yarım indirme) ve `<id>.src.part.meta` (devam mührü)
        // dosyaları bırakabiliyor; bunlar bu önekle eşleştiği için ffmpeg'e
        // KAYNAK olarak verilebilirdi → yarım/bozuk ses ya da remux hatası.
        if name.ends_with(".part") || name.ends_with(".meta") {
            continue;
        }
        return Some(e.path());
    }
    None
}

/// Videonun sesini cache'e indirir (varsa indirmeden döner). Yol döndürür.
///
/// Hız için: bestaudio (m4a) indirilir ve ffmpeg ile YENİDEN KODLAMADAN
/// (-c:a copy) ADTS .aac'ye remux edilir (~0.1sn). Bu, mp3 dönüşümünün
/// (~2sn) maliyetini kaldırır ve rodio'nun m4a/MP4 başlatma paniğini önler
/// (panik MP4 konteynerinde; ADTS akışında yok). m4a değilse (opus/webm)
/// aac'ye transcode'a düşülür.
/// ⭐ BORU HATTI: İNDİRİRKEN DÖNÜŞTÜR (v1.9.0).
///
/// Klasik yol: önce dosyanın TAMAMI inip diske yazılır, SONRA ffmpeg onu
/// ADTS'ye çevirir — iki iş sırayla yapılır. Oysa indirdiğimiz baytları
/// doğrudan ffmpeg'in borusuna verirsek dönüştürme indirmeyle BİRLİKTE akar
/// ve dönüştürme süresi (~0.3-0.5 sn) tamamen kaybolur. Akış yolu (v1.8.1)
/// zaten bunu yapıyordu; burada aynı motoru "sonuna kadar bekleyen" biçimde
/// normal indirmede de kullanıyoruz.
///
/// ⚠️ Yalnız GÜVENLİ olduğu durumda: kaynak mp4/m4a (ADTS'ye `-c:a copy` ile
/// geçebilir) ve kalite ayarı yeniden kodlama istemiyor. Aksi hâlde None döner
/// ve çağıran klasik yola devam eder — davranış değişmez.
fn pipeline_to_aac(
    cache_dir: &Path,
    video_id: &str,
    src: native_dl::AudioSource,
) -> Option<std::path::PathBuf> {
    if audio_quality() == "medium" {
        return None; // 96k yeniden kodlama gerekir, `copy` yetmez
    }
    // googlevideo adresi taşıdığı mime'ı söyler; mp4 değilse `copy` başarısız
    // olur ve dosyayı BOŞUNA bir kez daha indirmek zorunda kalırdık.
    let is_mp4 = src.url.contains("mime=audio%2Fmp4") || src.url.contains("mime=audio/mp4");
    if !is_mp4 {
        return None;
    }
    if !native_dl::probe_url(&src) {
        return None;
    }
    let dest = cache_dir.join(format!("{video_id}.stream.aac"));
    let h = native_dl::stream_to_adts(src, dest, ffmpeg()).ok()?;
    // Akış yolundan farkı: burada SONUNA KADAR bekliyoruz.
    while !h.done.load(std::sync::atomic::Ordering::Relaxed) {
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    let _ = std::fs::remove_file(&h.path); // geçici .stream.aac
    if h.failed.load(std::sync::atomic::Ordering::Relaxed) {
        return None;
    }
    // stream_to_adts başarıda nihai ada kopyalar.
    let final_path = cache_dir.join(format!("{video_id}.aac"));
    final_path.exists().then_some(final_path)
}

pub fn ensure_audio(
    cache_dir: &Path,
    video_id: &str,
    cookies: Option<&str>,
) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(cache_dir)?;
    if let Some(p) = find_cached(cache_dir, video_id) {
        return Ok(p);
    }
    // Şarkının hazır olma süresi — "çalmaya basınca ne kadar bekliyorum"
    // sorusunun tek güvenilir cevabı. Aşamalar (adres/indirme/remux) ayrı ayrı
    // loglanıyor; bu toplam.
    let t_start = std::time::Instant::now();

    // Aynı video için başka bir indirme sürüyorsa bekle (dosya çakışmasını önle).
    let lock = inflight_lock(video_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    // Kilidi aldıktan sonra tekrar bak: beklerken başka çağrı indirmiş olabilir.
    if let Some(p) = find_cached(cache_dir, video_id) {
        return Ok(p);
    }

    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let dl_tmpl = cache_dir.join(format!("{video_id}.src.%(ext)s"));

    // Panik yerine anlaşılır hata: Windows'ta yol geçersiz UTF-8 içerebilir.
    let dl_tmpl_str = dl_tmpl
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("önbellek yolu okunamadı (geçersiz karakter)"))?;
    let ff = ffmpeg_path();
    let ff_str = ff.as_ref().map(|p| p.to_string_lossy());

    // Teşhis: hangi ikilileri ve ffmpeg yolunu kullanıyoruz? (Windows'ta
    // sidecar bulunamazsa burada görünür.)
    log::info!(
        "ensure_audio {video_id}: yt-dlp={:?}, ffmpeg={:?}",
        resolve_bin("yt-dlp"),
        ff.as_deref().map(|p| p.display().to_string())
    );
    // ⭐ SES KALİTESİ (v1.6.0): kullanıcı ayarı. "low" seçilirse YouTube'un
    // düşük bit hızlı m4a'sı (itag 139, ~48k HE-AAC) tercih edilir → dosyalar
    // ~3 kat küçülür. Kalite gözle görülür düşer; bu yüzden VARSAYILAN "high".
    // Kaliteyi düşürmeden küçültmek mümkün değil: opus daha verimli ama
    // symphonia (rodio) opus çözemiyor.
    // ⚠️ YouTube m4a'da yalnız İKİ kademe sunuyor (ölçüldü): itag 139 (~49k) ve
    // 140 (~130k). ARASI YOK. Opus 51k/134k daha verimli ama symphonia (rodio)
    // opus çözemiyor → kullanılamaz.
    //   • "low"    → 139'u tercih et (kaynaktan, kayıpsız seçim)
    //   • "medium" → 140 indirilir, ffmpeg ile 96k AAC'ye YENİDEN KODLANIR
    //                (aşağıdaki remux adımı). Kaynakta 96k olmadığı için tek yol
    //                bu; çift kodlama nedeniyle kalite native 96k'dan düşüktür.
    //   • "high"   → 140, yeniden kodlama YOK (kopyalanır).
    let fmt = if audio_quality() == "low" {
        "bestaudio[ext=m4a][abr<=70]/bestaudio[abr<=70]/bestaudio[ext=m4a]/bestaudio/best"
    } else {
        "bestaudio[ext=m4a]/bestaudio/best[height<=480]/best"
    };
    let mut args: Vec<&str> = vec![
        // /best fallback ŞART: eski/sınırlı yt-dlp (özellikle Windows sidecar)
        // YouTube'un nsig/JS challenge'ını çözemeyince audio-only DASH formatları
        // görünmez ve "Requested format is not available" hatası gelir. Bu durumda
        // muxed 'best' (video+ses) indirilir ve ffmpeg ile sadece ses çıkarılır (-vn).
        // height<=480: muxed'e düşülürse gereksiz büyük video inmesin (ses için yeter).
        // NOT: player_client'ı 'android'e ZORLAMA — android yalnızca muxed
        // format 18'i (96k, düşük kaliteli ses) verir. Default client (çerezsiz)
        // yt-dlp'nin kendi JS çözücüsüyle audio-only 140'ı (128k m4a, kaliteli)
        // verir; nsig için deno bile gerekmez. O yüzden default bırakılır.
        // NOT: -N (paralel parça) KULLANMA — ses dosyaları küçük; paralel bağlantı
        // + çok eşzamanlı indirme YouTube throttle'ına (HTTP 403/416) yol açıyordu.
        // Tek bağlantı daha güvenilir.
        "-f",
        fmt,
        "--no-playlist",
        "--no-warnings",
        "--no-part",
        // Tek çağrı içindeki GEÇİCİ HTTP hatalarına (403/429 throttle) karşı
        // yt-dlp'nin kendi yeniden denemeleri. Aynı format URL'sine tekrar
        // vurur; asıl kurtarma app seviyesindeki taze-çıkarım döngüsündedir
        // (aşağıda), bu ilk savunma hattı.
        "--retries",
        "3",
        "--fragment-retries",
        "3",
    ];
    // ffmpeg'i açıkça bildir (DASH m4a düzeltmesi için; Windows'ta şart).
    if let Some(s) = ff_str.as_deref() {
        args.push("--ffmpeg-location");
        args.push(s);
    }
    args.extend(["-o", dl_tmpl_str, "--", &url]);

    // ═══ KATMAN 0: ÖNCEDEN ÇÖZÜLMÜŞ ADRES (önbellek) — EN HIZLI YOL ═══
    // Prefetch sırasında sıradaki şarkıların adresleri toplu çözülüp
    // saklanıyor (bkz. prewarm_urls). Hazır adres varken daha yavaş yolları
    // denemek anlamsız: bu yol yt-dlp de çalıştırmaz, InnerTube'un boşa 1 MB
    // indirmesini de yaşamaz → şarkı doğrudan inmeye başlar.
    let mut native_ok = false;
    if let Some(src) = native_dl::cached_source(video_id) {
        match native_dl::fetch_with_url(
            cache_dir,
            video_id,
            &src.url,
            &src.user_agent,
            src.content_length,
        ) {
            Ok(_) => {
                log::info!("önbellekteki adresle indirildi {video_id}");
                native_ok = true;
            }
            Err(e) => {
                log::info!(
                    "önbellek adresi tutmadı {video_id}: {}",
                    first_line(&e.to_string())
                );
                // Ölü adresi önbellekte BIRAKMA: bir sonraki denemede yine
                // seçilip katmanları boşuna tüketirdi (ölçüldü: 15.6 sn).
                native_dl::forget_url(video_id);
                if let Some(pth) = find_src(cache_dir, video_id) {
                    let _ = std::fs::remove_file(pth);
                }
            }
        }
    }

    // ═══ KATMAN 1: RESONANCE YEREL İNDİRİCİ (yt-dlp ÇALIŞTIRILMADAN) ═══
    // Başarılıysa yt-dlp süreci hiç başlamaz → şarkı başına ~1.5-3 sn tasarruf
    // ve yt-dlp'nin bot/403 davranışına hiç maruz kalınmaz. Ölçümde bu yol
    // bazı videolarda 1 MB'da kısıtlanıyor (PO Token yok) — o zaman sessizce
    // katman 2'ye düşülür.
    let low = audio_quality() == "low";
    if !native_ok {
        native_ok = match native_dl::fetch(cache_dir, video_id, low) {
            Ok(_) => true,
            Err(e) => {
                log::info!(
                    "yerel indirici olmadı {video_id}: {}",
                    first_line(&e.to_string())
                );
                false
            }
        };
    }

    // ═══ KATMAN 2: URL'yi yt-dlp ÇÖZER, baytları YEREL İNDİRİCİ çeker ═══
    // Duvar URL çözümünde (imza/nsig/PO Token → JS çalıştırma gerekir);
    // çözülmüş URL'den indirmek serbest (ölçüldü). Böylece yt-dlp'nin kendi
    // indirme katmanı ve onun 403/yarıda-kesilme davranışı devre dışı kalır.
    if !native_ok {
        for (name, extra, use_cookies) in NATIVE_URL_STRATEGIES {
            if use_cookies && cookies.map(|c| c.is_empty()).unwrap_or(true) {
                continue;
            }
            let ck = if use_cookies { cookies } else { None };
            let Some((u, ua, len)) = resolve_url_with_ytdlp(&args, extra, ck) else {
                continue;
            };
            native_dl::cache_url(video_id, &u, &ua, len);
            // ⭐ Önce BORU HATTI: indirirken dönüştür (dönüştürme süresi kaybolur).
            let piped = pipeline_to_aac(
                cache_dir,
                video_id,
                native_dl::AudioSource {
                    url: u.clone(),
                    user_agent: ua.clone(),
                    content_length: len,
                    via: format!("yt-dlp:{name}"),
                },
            );
            if let Some(p) = piped {
                log::info!("boru hattı ({name}) ile hazır {video_id}");
                return Ok(p);
            }
            match native_dl::fetch_with_url(cache_dir, video_id, &u, &ua, len) {
                Ok(_) => {
                    log::info!("yerel indirici + {name} URL ile kurtarıldı {video_id}");
                    native_ok = true;
                    break;
                }
                Err(e) => {
                    log::info!(
                        "yerel indirme ({name}) başarısız {video_id}: {}",
                        first_line(&e.to_string())
                    );
                    if let Some(pth) = find_src(cache_dir, video_id) {
                        let _ = std::fs::remove_file(pth);
                    }
                }
            }
        }
    }

    // ⭐⭐ KATMAN 3 — ÇOK YOLLU yt-dlp İNDİRME (v1.8.0).
    //
    // KÖK NEDEN: YouTube bot doğrulaması + PO Token zorunluluğu getirdi.
    // Varsayılan istemci artık ya "Sign in to confirm you're not a bot" ya da
    // bayt indirmede "HTTP 403 Forbidden" döndürüyor. Tek istemciye bağlı
    // kalmak, kullanıcının gördüğü "şarkı indirilemedi"nin KÖK SEBEBİYDİ
    // (v1.2.3'teki taze-çıkarım retry'ı bunu çözemez: aynı duvara 3 kez vurur).
    //
    // ÖLÇÜM (2026-08-19, uygulama logunda 403/bot veren 5 video):
    //   default (android_vr) → 403 / bot                          ❌
    //   tv                   → "Requested format is not available" ❌
    //   ios                  → "Requested format is not available" ❌
    //   web_embedded         → 4/4 indi, AUDIO-ONLY m4a (2.3–4.0 MB) ✅ EN İYİ
    //   mweb                 → indi ama MUXED mp4 (11.4 MB = 3× veri) ✅
    //   tv_simply            → indi ama MUXED mp4                     ✅
    //
    // ⚠️ "Kendi ham indiricimizi yazalım" ÇÖZÜM DEĞİL: bu duvarı aşan şey
    // yt-dlp'nin imza/nsig JS çözücüsü ve istemci taklididir; elle yazılmış bir
    // HTTP indirici aynı 403'ü alır ve YouTube her değişiklikte kırılır.
    // Doğru çözüm YOL ÇEŞİTLİLİĞİ + taze çıkarımdır (aşağısı).
    //
    // Sıra: audio-only veren yol önce, muxed olanlar sonra (gereksiz video
    // baytı inmesin), çerez en sonda (yavaş + bot moduna sokabilir).
    // Katman 2'nin deneyeceği çözüm yolları (indirme YOK, yalnız URL).
    const NATIVE_URL_STRATEGIES: [(&str, Option<&str>, bool); 3] = [
        ("web_embedded", Some("youtube:player_client=web_embedded"), false),
        ("default", None, false),
        ("cookies", None, true),
    ];

    const STRATEGIES: [(&str, Option<&str>, bool); 5] = [
        ("web_embedded", Some("youtube:player_client=web_embedded"), false),
        ("default", None, false),
        ("mweb", Some("youtube:player_client=mweb"), false),
        ("tv_simply", Some("youtube:player_client=tv_simply"), false),
        ("cookies", None, true),
    ];

    // ⭐ ÖĞRENEN SIRA: en son işe yarayan yol bir sonraki indirmede İLK denenir.
    // YouTube'un hangi yolu kapattığı zamanla değişiyor; sabit sıra her seferinde
    // ölü yola çarpıp saniyeler kaybettirirdi.
    let start = native_dl::stored_strategy()
        .unwrap_or_else(|| LAST_GOOD_STRATEGY.load(Ordering::Relaxed))
        % STRATEGIES.len();
    let mut out: Option<std::process::Output> = None;
    let mut last_err = String::new();

    'outer: for round in 0..2 {
        if native_ok {
            break;
        }
        for k in 0..STRATEGIES.len() {
            let idx = (start + k) % STRATEGIES.len();
            let (name, extra, use_cookies) = STRATEGIES[idx];
            // Çerez yolu yalnız kullanıcı tarayıcı seçtiyse anlamlı.
            if use_cookies && cookies.map(|c| c.is_empty()).unwrap_or(true) {
                continue;
            }
            let mut a = args.clone();
            if let Some(e) = extra {
                a.insert(0, "--extractor-args");
                a.insert(1, e);
            }
            // İndirme: 4 dakika. (Bilgi çağrılarının 120 sn'si burada yetmez;
            // yavaş bağlantıda 4 MB'lık dosya daha uzun sürebilir.)
            let o = run_yt_dlp_timeout(&a, if use_cookies { cookies } else { None }, 240)?;
            if o.status.success() {
                LAST_GOOD_STRATEGY.store(idx, Ordering::Relaxed);
                // ⭐ Diske de yaz: bir sonraki AÇILIŞTA da ilk bu denensin.
                // Yoksa her açılışta bu makinede çalışmayan yollar yeniden
                // deneniyor ve ilk şarkılar boşuna geç başlıyordu.
                native_dl::store_strategy(idx);
                if k > 0 || round > 0 {
                    log::info!("indirme kurtarıldı {video_id} — yol: {name}");
                }
                out = Some(o);
                break 'outer;
            }
            let err = String::from_utf8_lossy(&o.stderr).into_owned();
            // Kalıcı hata (silinmiş/özel/erişilemez): hiçbir yol kurtarmaz.
            if is_permanent_error(&err) {
                log::error!("kalıcı hata {video_id}: {}", err.trim());
                anyhow::bail!("Bu video kullanılamıyor (kaldırılmış/özel/kısıtlı).");
            }
            log::info!("yol '{name}' başarısız ({video_id}): {}", first_line(&err));
            last_err = err;
            // Yarım kalan dosya sonraki yolu bozmasın (416 / "invalid data").
            if let Some(p) = find_src(cache_dir, video_id) {
                let _ = std::fs::remove_file(p);
            }
        }
        // Tüm yollar tükendi: kısa bekleyip TAZE format URL'leriyle bir tur daha.
        // (Ölçüldü: 403 veren video saniyeler sonra aynı argümanla iniyor.)
        if round == 0 {
            std::thread::sleep(std::time::Duration::from_millis(1500));
        }
    }

    // Her iki tur da tükendiyse: teşhis logu + vazgeç.
    if out.is_none() && !native_ok {
        log::error!("yt-dlp indirme hata {video_id}: {}", last_err.trim());
        // Teşhis: YouTube hangi formatları sunuyor?
        if let Ok(lf) = run_yt_dlp(&["-F", "--no-warnings", "--", &url], None) {
            log::error!(
                "mevcut formatlar {video_id}:\n{}",
                String::from_utf8_lossy(&lf.stdout).trim()
            );
        }
        anyhow::bail!("İndirme başarısız: {}", last_err.trim());
    }

    let src = find_src(cache_dir, video_id)
        .ok_or_else(|| anyhow::anyhow!("indirilen kaynak bulunamadı ({video_id})"))?;
    let target = cache_dir.join(format!("{video_id}.aac"));

    // "medium" seçiliyse KOPYALAMA yerine 96k'ya yeniden kodla. YouTube 96k
    // sunmadığı (yalnız 49k / 130k) için orta kademe ancak böyle elde edilir.
    // Çift kodlama olduğundan native 96k'dan bir tık kötüdür; kullanıcıya
    // arayüzde bu açıkça yazılıyor.
    let medium = audio_quality() == "medium";

    // 1) Hızlı yol: AAC akışını kopyalayarak ADTS'ye remux et.
    //    (medium'da kopyalama atlanır → aşağıdaki transcode dalına düşer.)
    let remux = if medium {
        None
    } else {
        Some(
            {
                let mut c = ffmpeg();
                c.args(["-y", "-v", "error", "-i"])
                    .arg(&src)
                    // -vn: video varsa (muxed best) at — sadece ses
                    .args(["-vn", "-c:a", "copy", "-f", "adts"])
                    .arg(&target);
                output_timeout(c, 120)
            },
        )
    };
    let copied = match &remux {
        None => false, // medium → bilerek transcode
        Some(r) => match r {
            Ok(o) => o.status.success(),
            Err(e) => {
                // ffmpeg hiç çalıştırılamadı (bulunamadı). Windows'ta en olası kök neden.
                log::error!("ffmpeg çalıştırılamadı (remux): {e}");
                false
            }
        },
    };

    // 2) Kaynak AAC değilse (opus/webm) ya da kopyalama başarısızsa transcode et.
    if !copied || !target.exists() {
        let _ = std::fs::remove_file(&target);
        let mut enc = ffmpeg();
        enc.args(["-y", "-v", "error", "-i"])
            .arg(&src)
            // -vn: video varsa (muxed best) at — sadece ses
            .args([
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                // medium → 96k (küçültme amaçlı); diğer durumlarda bu dal yalnız
                // KURTARMA yoludur (kaynak AAC değil) → kaliteyi düşürme.
                if medium { "96k" } else { "192k" },
                "-f",
                "adts",
            ])
            .arg(&target);
        match output_timeout(enc, 180)
        {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                let _ = std::fs::remove_file(&src);
                let err = String::from_utf8_lossy(&o.stderr);
                log::error!("ffmpeg dönüştürme hata {video_id}: {}", err.trim());
                anyhow::bail!("Ses dönüştürme başarısız (ffmpeg): {}", err.trim());
            }
            Err(e) => {
                let _ = std::fs::remove_file(&src);
                // ffmpeg bulunamadı — kullanıcıya net söyle (yol bilgisiyle).
                anyhow::bail!(
                    "ffmpeg bulunamadı/çalıştırılamadı ({e}). ffmpeg yolu: {:?}",
                    ff.as_deref().map(|p| p.display().to_string())
                );
            }
        }
    }

    let _ = std::fs::remove_file(&src);
    if target.exists() {
        log::info!(
            "hazır {video_id}: {:.2} sn (indirme+dönüştürme)",
            t_start.elapsed().as_secs_f32()
        );
        Ok(target)
    } else {
        anyhow::bail!("ses dönüştürme başarısız ({video_id})");
    }
}

/// Dosya önbellekte hazır mı? (akışlı çalma yalnız hazır DEĞİLKEN denenir)
pub fn is_cached_file(cache_dir: &Path, video_id: &str) -> bool {
    find_cached(cache_dir, video_id).is_some()
}

fn find_cached(cache_dir: &Path, video_id: &str) -> Option<PathBuf> {
    // aac önce: yeni standart biçimimiz (mp3 eski indirmeler için).
    let exts = ["aac", "mp3", "m4a", "opus", "ogg", "flac", "wav", "webm"];
    for ext in exts {
        let p = cache_dir.join(format!("{video_id}.{ext}"));
        if p.exists() {
            return Some(p);
        }
    }
    None
}

// YouTube otomatik "Sanatçı - Topic" kanallarını temizler.
fn clean_artist(artist: &str) -> String {
    artist
        .trim()
        .strip_suffix(" - Topic")
        .unwrap_or(artist)
        .trim()
        .to_string()
}

fn best_thumb(v: &serde_json::Value, id: &str) -> String {
    if let Some(arr) = v.get("thumbnails").and_then(|t| t.as_array()) {
        if let Some(last) = arr.last() {
            if let Some(u) = last.get("url").and_then(|u| u.as_str()) {
                return u.to_string();
            }
        }
    }
    if let Some(u) = v.get("thumbnail").and_then(|u| u.as_str()) {
        return u.to_string();
    }
    format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ALTERNATİF KAYNAK testi (ağ ister):
    ///   cargo test --lib alternative -- --ignored --nocapture
    ///
    /// "Bu video inmiyorsa aynı şarkının başka yüklemesini bul" yolunun
    /// gerçekten işe yaradığını ve YANLIŞ eşleşme (mix/canlı/başka şarkı)
    /// getirmediğini doğrular.
    #[test]
    #[ignore]
    fn alternative_source_found() {
        // Bilinen bir şarkı; "exclude" olarak uydurma bir id veriyoruz ki
        // arama sonucundaki her aday geçerli sayılsın.
        let alt = find_alternative(
            "Get Lucky",
            "Daft Punk",
            248_000, // ~4:08
            "ZZZZZZZZZZZ",
            None,
        );
        let a = alt.expect("alternatif bulunamadı");
        println!("bulundu: {} — {} ({} ms)", a.artist, a.title, a.duration_ms);
        assert!(a.duration_ms > 0, "süre bilinmiyor");
        // Süre ±%20 içinde olmalı (yanlış şarkı/mix gelmesin).
        let diff = 248_000u64.abs_diff(a.duration_ms);
        assert!(diff * 5 <= 248_000, "süre çok saptı: {} ms", a.duration_ms);
        let t = a.title.to_lowercase();
        assert!(!t.contains("full album"), "yanlış içerik: {t}");
    }
}
