// yt-dlp sarmalayıcı: YouTube arama + ses indirme.
// Ses, symphonia'nın güvenilir çözebildiği m4a/AAC olarak indirilir
// (gerekirse ffmpeg ile bir kez remux/transcode edilir) ve cache'lenir.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};

// Aynı video_id için eşzamanlı ensure_audio çağrılarını SERİLEŞTİRİR. Play +
// prefetch + radyo besleme aynı şarkıyı aynı anda indirmeye kalkınca aynı
// .src dosyasına yazıp birbirini bozuyordu (HTTP 416, "no such file",
// "invalid data"). Video başına tek kilit → ilk indirir, diğerleri bekleyip
// hazır dosyayı bulur.
fn inflight_lock(video_id: &str) -> Arc<Mutex<()>> {
    static MAP: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let map = MAP.get_or_init(|| Mutex::new(HashMap::new()));
    let mut m = map.lock().unwrap();
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
fn run_yt_dlp(args: &[&str], cookies: Option<&str>) -> std::io::Result<std::process::Output> {
    let out = yt_dlp(cookies).args(args).output()?;
    if cookies.is_some() && !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if is_cookie_error(&stderr) {
            return yt_dlp(None).args(args).output();
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
    *AUDIO_QUALITY.lock().unwrap() = q.to_string();
}

fn audio_quality() -> String {
    AUDIO_QUALITY.lock().unwrap().clone()
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

// İndirilen geçici kaynak dosyasını (<id>.src.<ext>) bulur.
fn find_src(cache_dir: &Path, video_id: &str) -> Option<PathBuf> {
    let prefix = format!("{video_id}.src.");
    for e in std::fs::read_dir(cache_dir).ok()?.flatten() {
        if e.file_name().to_string_lossy().starts_with(&prefix) {
            return Some(e.path());
        }
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
pub fn ensure_audio(
    cache_dir: &Path,
    video_id: &str,
    cookies: Option<&str>,
) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(cache_dir)?;
    if let Some(p) = find_cached(cache_dir, video_id) {
        return Ok(p);
    }

    // Aynı video için başka bir indirme sürüyorsa bekle (dosya çakışmasını önle).
    let lock = inflight_lock(video_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    // Kilidi aldıktan sonra tekrar bak: beklerken başka çağrı indirmiş olabilir.
    if let Some(p) = find_cached(cache_dir, video_id) {
        return Ok(p);
    }

    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let dl_tmpl = cache_dir.join(format!("{video_id}.src.%(ext)s"));

    let dl_tmpl_str = dl_tmpl.to_str().unwrap();
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

    // ⭐ TAZE-ÇIKARIM RETRY (v1.2.3): asıl ses baytlarını indirirken YouTube
    // çok sayıda eşzamanlı istek (Keşfet prefetch + radyo besleme + toplu
    // indirme) altında GEÇİCİ "HTTP 403 Forbidden" döndürüyor. Format çözülür
    // (--simulate geçer) ama bayt indirme reddedilir → "indirilemedi". Ölçüldü:
    // 403 veren videolar birkaç saniye/dakika sonra AYNI argümanla iniyor,
    // çünkü her yeni yt-dlp çağrısı TAZE format URL'si üretir. O yüzden geçici
    // hatada kısa (artan) bekleyip yeniden dene — tek deneme yerine 3.
    //
    // Çerez: kullanıcı tarayıcı seçtiyse İLK başarısızlıkta bir kez çerezle de
    // dene (yaş/bölge kısıtlı içerik için; 403 throttle'a etkisi yok, zararsız).
    const MAX_ATTEMPTS: usize = 3;
    let mut out: Option<std::process::Output> = None;
    let mut last_err = String::new();
    for attempt in 0..MAX_ATTEMPTS {
        let o = run_yt_dlp(&args, None)?;
        if o.status.success() {
            out = Some(o);
            break;
        }
        let err = String::from_utf8_lossy(&o.stderr).into_owned();
        // Kalıcı hata (silinmiş/özel/erişilemez): ne çerez ne retry kurtarır.
        if is_permanent_error(&err) {
            log::error!("kalıcı hata {video_id}: {}", err.trim());
            anyhow::bail!("Bu video kullanılamıyor (kaldırılmış/özel/kısıtlı).");
        }
        // İlk denemede çerezli tek deneme (yaş/bölge kısıtı için).
        if attempt == 0 {
            if let Some(c) = cookies {
                if !c.is_empty() {
                    log::info!("çerezsiz başarısız, çerezle deneniyor: {video_id}");
                    let oc = run_yt_dlp(&args, Some(c))?;
                    if oc.status.success() {
                        out = Some(oc);
                        break;
                    }
                    let errc = String::from_utf8_lossy(&oc.stderr).into_owned();
                    if is_permanent_error(&errc) {
                        anyhow::bail!("Bu video kullanılamıyor (kaldırılmış/özel/kısıtlı).");
                    }
                }
            }
        }
        last_err = err;
        // Son deneme değilse: artan bekleme (throttle'ı azdırmamak için), sonra
        // TAZE çıkarımla yeniden. 1.2sn, 2.4sn.
        if attempt + 1 < MAX_ATTEMPTS {
            let backoff = std::time::Duration::from_millis(1200 * (attempt as u64 + 1));
            log::info!(
                "geçici indirme hatası {video_id} (deneme {}/{}), {}ms sonra yeniden: {}",
                attempt + 1,
                MAX_ATTEMPTS,
                backoff.as_millis(),
                last_err.trim()
            );
            std::thread::sleep(backoff);
        }
    }

    // Tüm denemeler geçici hatayla tükendiyse: teşhis logu + vazgeç. (Başarıda
    // indirilen dosya diskte; aşağıda find_src ile bulunup remux edilir.)
    if out.is_none() {
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
            ffmpeg()
                .args([
                    "-y",
                    "-v",
                    "error",
                    "-i",
                    src.to_str().unwrap(),
                    "-vn", // video varsa (muxed best) at — sadece ses
                    "-c:a",
                    "copy",
                    "-f",
                    "adts",
                    target.to_str().unwrap(),
                ])
                .output(),
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
        match ffmpeg()
            .args([
                "-y",
                "-v",
                "error",
                "-i",
                src.to_str().unwrap(),
                "-vn", // video varsa (muxed best) at — sadece ses
                "-c:a",
                "aac",
                "-b:a",
                // medium → 96k (küçültme amaçlı); diğer durumlarda bu dal yalnız
                // KURTARMA yoludur (kaynak AAC değil) → kaliteyi düşürme.
                if medium { "96k" } else { "192k" },
                "-f",
                "adts",
                target.to_str().unwrap(),
            ])
            .output()
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
        Ok(target)
    } else {
        anyhow::bail!("ses dönüştürme başarısız ({video_id})");
    }
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
