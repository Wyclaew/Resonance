// Frontend'e açılan Tauri komutları: arama + oynatma kontrolü.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::audio::{AudioCmd, AudioHandle};
use crate::spotify;
use crate::ytdlp::{self, PlaylistMeta, SearchResult};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayInput {
    pub source_id: String,
    pub duration_ms: u64,
    pub track_id: String,
    #[serde(default)]
    pub resume_ms: u64, // kaldığın yerden devam (0 = baştan)
    /// Yerel dosya yolu (source = "local"). Verilirse İNDİRME YAPILMAZ.
    #[serde(default)]
    pub local_path: Option<String>,
    /// Alternatif kaynak araması için (bu video inmezse aynı şarkının başka
    /// yüklemesi bulunur). Boşsa alternatif denenmez.
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    /// Crossfade süresi (ms). 0 = anında geçiş (varsayılan davranış).
    #[serde(default)]
    pub fade_ms: u64,
}

fn audio_cache_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app.path().app_cache_dir()?.join("audio");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[tauri::command]
pub async fn search_youtube(
    query: String,
    limit: Option<u32>,
    cookies_browser: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(20);
    tauri::async_runtime::spawn_blocking(move || {
        ytdlp::search(&query, limit, cookies_browser.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// YouTube Music radyosu: bir video id'sinden benzer ŞARKILAR (bkz. ytdlp::music_radio).
/// Öneri motorunun YouTube kaynağı budur — metin araması değil.
#[tauri::command]
pub async fn music_radio(
    video_id: String,
    limit: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(50);
    tauri::async_runtime::spawn_blocking(move || ytdlp::music_radio(&video_id, limit))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Ses kalitesi tercihini ayarlar ("high" | "low"). Açılışta ve ayar
/// değişince frontend çağırır.
#[tauri::command]
pub fn set_audio_quality(quality: String) {
    ytdlp::set_audio_quality(&quality);
}

/// Keşfet tür/ruh hali havuzu — YouTube Music'in küratörlü listelerinden
/// gerçek şarkılar (bkz. ytdlp::music_genre_pool).
#[tauri::command]
pub async fn music_genre_pool(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(60);
    tauri::async_runtime::spawn_blocking(move || ytdlp::music_genre_pool(&query, limit))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// YouTube / YouTube Music çalma listesi URL'inden başlık + şarkıları çıkarır.
#[tauri::command]
pub async fn import_playlist(
    url: String,
    cookies_browser: Option<String>,
) -> Result<PlaylistMeta, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ytdlp::playlist_meta(&url, cookies_browser.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyImport {
    pub name: String,
    pub tracks: Vec<SearchResult>,
    pub total: u64,
}

/// Spotify public playlist'i içe aktarır: metadata'yı Spotify API'den çeker,
/// her şarkıyı YouTube'da eşleştirir (4 paralel), ilerlemeyi olayla bildirir.
#[tauri::command]
pub async fn import_spotify(
    app: AppHandle,
    url: String,
    client_id: String,
    client_secret: String,
    cookies_browser: Option<String>,
) -> Result<SpotifyImport, String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<SpotifyImport> {
        let pid = spotify::playlist_id_from_url(&url)
            .ok_or_else(|| anyhow::anyhow!("Geçersiz Spotify çalma listesi linki"))?;

        // Anahtar GİRİLMEMİŞSE: anahtarsız (embed) yolu — kullanıcı yalnızca linki
        // yapıştırır, hesap/uygulama açmasına gerek kalmaz (≤100 şarkı).
        // Anahtar girilmişse: API yolu — tam liste (100+ sayfalı).
        let has_keys =
            !client_id.trim().is_empty() && !client_secret.trim().is_empty();
        let (name, sp_tracks) = if has_keys {
            match spotify::get_token(&client_id, &client_secret)
                .and_then(|token| spotify::fetch_playlist(&token, &pid))
            {
                Ok(v) => v,
                Err(e) => {
                    // Anahtar hatalıysa kullanıcıyı çıkmaza sokma: anahtarsız dene.
                    log::warn!("Spotify API başarısız, anahtarsız deneniyor: {e}");
                    spotify::fetch_playlist_public(&pid)?
                }
            }
        } else {
            spotify::fetch_playlist_public(&pid)?
        };
        let total = sp_tracks.len();
        let _ = app2.emit("spotify-progress", serde_json::json!({"done": 0, "total": total}));

        let cookies = cookies_browser.as_deref();
        let matched: std::sync::Mutex<Vec<Option<SearchResult>>> =
            std::sync::Mutex::new(vec![None; total]);
        let next = std::sync::atomic::AtomicUsize::new(0);
        let done = std::sync::atomic::AtomicUsize::new(0);

        std::thread::scope(|s| {
            for _ in 0..4 {
                s.spawn(|| loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= total {
                        break;
                    }
                    let q = format!("{} {}", sp_tracks[i].artist, sp_tracks[i].title);
                    let res = ytdlp::search(&q, 1, cookies)
                        .ok()
                        .and_then(|v| v.into_iter().next());
                    if let Ok(mut m) = matched.lock() {
                        m[i] = res;
                    }
                    let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                    let _ = app2.emit(
                        "spotify-progress",
                        serde_json::json!({"done": d, "total": total}),
                    );
                });
            }
        });

        let tracks: Vec<SearchResult> = matched
            .into_inner()
            .unwrap_or_default()
            .into_iter()
            .flatten()
            .collect();
        Ok(SpotifyImport {
            name,
            tracks,
            total: total as u64,
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    synced: Option<String>,
    plain: Option<String>,
}

// YouTube başlık gürültüsünü temizle (Official Video, [..], feat. vb.) ki
// lrclib eşleşmesi tutsun.
fn clean_title(title: &str, artist: &str) -> String {
    let mut t = title.to_string();
    // parantez/köşeli parantez içini kaldır
    while let (Some(a), Some(b)) = (t.find('('), t.find(')')) {
        if a < b {
            t.replace_range(a..=b, "");
        } else {
            break;
        }
    }
    while let (Some(a), Some(b)) = (t.find('['), t.find(']')) {
        if a < b {
            t.replace_range(a..=b, "");
        } else {
            break;
        }
    }
    let lower = t.to_lowercase();
    for marker in [" feat.", " feat ", " ft.", " ft ", " featuring "] {
        if let Some(i) = lower.find(marker) {
            t.truncate(i);
            break;
        }
    }
    // "Sanatçı - Şarkı" → "Şarkı"
    if let Some(i) = t.find(" - ") {
        let (left, right) = t.split_at(i);
        if left.trim().to_lowercase() == artist.trim().to_lowercase() || !artist.is_empty() {
            t = right[3..].to_string();
        }
    }
    t.trim().to_string()
}

/// lrclib.net'ten senkron (LRC) / düz şarkı sözü getirir. Anahtar gerekmez.
#[tauri::command]
pub async fn get_lyrics(
    artist: String,
    title: String,
    _duration_ms: u64,
) -> Result<Lyrics, String> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Lyrics> {
        let track = clean_title(&title, &artist);
        let client = reqwest::blocking::Client::builder()
            .user_agent("Resonance (personal music player)")
            .build()?;
        let resp = client
            .get("https://lrclib.net/api/search")
            .query(&[("track_name", track.as_str()), ("artist_name", artist.as_str())])
            .send()?;
        let arr: serde_json::Value = resp.json().unwrap_or(serde_json::Value::Null);

        let mut synced = None;
        let mut plain = None;
        if let Some(items) = arr.as_array() {
            for it in items {
                if synced.is_none() {
                    if let Some(s) = it.get("syncedLyrics").and_then(|x| x.as_str()) {
                        if !s.trim().is_empty() {
                            synced = Some(s.to_string());
                        }
                    }
                }
                if plain.is_none() {
                    if let Some(p) = it.get("plainLyrics").and_then(|x| x.as_str()) {
                        if !p.trim().is_empty() {
                            plain = Some(p.to_string());
                        }
                    }
                }
                if synced.is_some() {
                    break;
                }
            }
        }
        Ok(Lyrics { synced, plain })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// Her play_track çağrısına artan bir nesil no'su verilir. İndirme bitene kadar
// kullanıcı başka şarkı seçtiyse (nesil değiştiyse) o eski indirmenin sesi ses
// motoruna GÖNDERİLMEZ. Böylece hızlı geçişte "arayüz başka, çalan başka şarkı"
// yarışı olmaz. (İndirilen dosya cache'te kalır, boşa gitmez.)
static PLAY_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

// Arka plan indirme (prefetch + toplu indirme) eşzamanlılık sınırı. Çok sayıda
// yt-dlp'yi aynı anda çalıştırmak YouTube throttle'ına (HTTP 403/416) yol
// açıyordu. play_track bu sınıra TABİ DEĞİL (çalma her zaman öncelikli).
/// Adres ısıtma turu için ayrı sınır: aynı anda tek tur yeter, ve bu iş
/// gerçek indirmelerle YARIŞMAMALI (bkz. prewarm_urls).
fn prewarm_semaphore() -> &'static tokio::sync::Semaphore {
    static SEM: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
    SEM.get_or_init(|| tokio::sync::Semaphore::new(1))
}

fn dl_semaphore() -> &'static tokio::sync::Semaphore {
    static SEM: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
    // 2 → 3: yerel indirici sayesinde her hazırlık artık ayrı bir yt-dlp
    // süreci başlatmıyor (adres önbellekten geliyor), yani eşzamanlılık
    // maliyeti düştü. Tampon 5 şarkıya çıktığı için akış da hızlanmalı.
    SEM.get_or_init(|| tokio::sync::Semaphore::new(3))
}

/// ⭐ MİNİ OYNATICI (v1.8.3): küçük, hep üstte duran ikinci pencere.
///
/// ⚠️ İki webview AYRI JS bağlamıdır — zustand store'u paylaşmazlar. Mini
/// pencere durumu Rust'tan gelen `playback-tick` olayıyla öğrenir, komutları
/// da `mini-command` olayıyla ANA pencereye yollar (kuyruk mantığı orada).
#[tauri::command]
pub async fn toggle_mini_player(app: AppHandle) -> Result<bool, String> {
    if let Some(w) = app.get_webview_window("mini") {
        let _ = w.close();
        return Ok(false);
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "mini",
        tauri::WebviewUrl::App("index.html?mini=1".into()),
    )
    .title("Resonance")
    .inner_size(360.0, 128.0)
    .resizable(false)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(true)
}

/// Seçilen dosya/klasörleri tarar ve içe aktarılabilir parçaları döndürür.
#[tauri::command]
pub async fn scan_local_files(paths: Vec<String>) -> Result<Vec<ytdlp::LocalTrack>, String> {
    tauri::async_runtime::spawn_blocking(move || ytdlp::scan_local(&paths))
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricHit {
    pub title: String,
    pub artist: String,
    /// Eşleşen sözün kısa bir parçası (kullanıcı doğru şarkı mı görsün).
    pub snippet: String,
}

/// ⭐ SÖZDEN ŞARKI BULMA: aklında söz var ama ad yok.
/// lrclib'in kendi arama uçunu kullanır (anahtarsız). Sonuç YouTube'da
/// aranıp çalınır — burada yalnız "hangi şarkı?" sorusu cevaplanır.
#[tauri::command]
pub async fn search_lyrics(query: String) -> Result<Vec<LyricHit>, String> {
    if query.trim().len() < 3 {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Vec<LyricHit>> {
        let client = reqwest::blocking::Client::builder()
            .user_agent("Resonance (personal music player)")
            .timeout(std::time::Duration::from_secs(20))
            .build()?;
        let resp = client
            .get("https://lrclib.net/api/search")
            .query(&[("q", query.as_str())])
            .send()?;
        let arr: serde_json::Value = resp.json().unwrap_or(serde_json::Value::Null);
        let mut out = Vec::new();
        if let Some(items) = arr.as_array() {
            let needle = query.to_lowercase();
            for it in items.iter().take(25) {
                let title = it["trackName"].as_str().unwrap_or("").to_string();
                let artist = it["artistName"].as_str().unwrap_or("").to_string();
                if title.is_empty() {
                    continue;
                }
                // Eşleşen satırı bul — kullanıcı doğru şarkı olduğunu görsün.
                let plain = it["plainLyrics"].as_str().unwrap_or("");
                let snippet = plain
                    .lines()
                    .find(|l| l.to_lowercase().contains(&needle))
                    .unwrap_or_else(|| plain.lines().next().unwrap_or(""))
                    .trim()
                    .chars()
                    .take(90)
                    .collect::<String>();
                out.push(LyricHit {
                    title,
                    artist,
                    snippet,
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadHealth {
    pub mbps: f32,
    pub fail_rate: f32,
    /// Önerilen çevrimdışı tampon (kaç şarkı önden indirilsin).
    pub buffer: u32,
}

/// İndirme sağlığı — akıllı tampon için (bkz. native_dl::health).
#[tauri::command]
pub fn download_health() -> DownloadHealth {
    let (mbps, fail_rate, buffer) = crate::native_dl::health();
    DownloadHealth {
        mbps,
        fail_rate,
        buffer,
    }
}

/// Açılışta artık kullanılmayan akış dosyalarını (`*.stream.aac`) siler.
///
/// İndirirken çalma yolunda bu dosyalar geçicidir: tamamlanınca nihai
/// `<id>.aac` adına KOPYALANIR (taşınmaz, çünkü ses motoru hâlâ okuyor
/// olabilir). Uygulama kapanınca hiçbiri kullanımda değildir → açılış,
/// bunları silmek için tek güvenli an.
pub fn cleanup_stream_files(app: &AppHandle) {
    let Ok(dir) = audio_cache_dir(app) else {
        return;
    };
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut n = 0;
    for e in rd.flatten() {
        if e.file_name().to_string_lossy().ends_with(".stream.aac")
            && std::fs::remove_file(e.path()).is_ok()
        {
            n += 1;
        }
    }
    if n > 0 {
        log::info!("{n} geçici akış dosyası temizlendi");
    }
}

#[tauri::command]
pub async fn play_track(
    app: AppHandle,
    audio: State<'_, AudioHandle>,
    input: PlayInput,
    cookies_browser: Option<String>,
) -> Result<(), String> {
    let my_gen = PLAY_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit("playback-loading", &input.track_id);

    let cache = audio_cache_dir(&app).map_err(|e| e.to_string())?;

    // ⭐ YEREL DOSYA: indirme/akış yollarının hiçbiri çalışmaz — dosya zaten
    // diskte. Gerekirse (m4a/opus gibi rodio'nun çözemediği formatlarda)
    // bir kez ADTS'ye çevrilir.
    if let Some(lp) = input.local_path.clone() {
        let cache_l = cache.clone();
        let path = tauri::async_runtime::spawn_blocking(move || {
            ytdlp::ensure_local_audio(&cache_l, &lp)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        if PLAY_GEN.load(Ordering::SeqCst) != my_gen {
            return Ok(());
        }
        audio.send(AudioCmd::Load {
            path,
            duration_ms: input.duration_ms,
            track_id: input.track_id,
            start_ms: input.resume_ms,
            fade_ms: input.fade_ms,
            growing: None,
        });
        return Ok(());
    }

    let sid = input.source_id.clone();
    let cookies = cookies_browser.clone();

    // ⭐ İNDİRİRKEN ÇALMA (v1.8.1): şarkının TAMAMINI beklemeden başla.
    //
    // Yalnızca gerçekten faydalı olduğu durumda denenir:
    //  • dosya önbellekte YOKSA (varsa zaten anında çalıyor),
    //  • baştan başlanıyorsa (resume varsa seek gerekir; yarım dosyada seek
    //    güvenilir değil → normal yol).
    // Herhangi bir aksilikte sessizce normal yola düşülür.
    let cache_s = cache.clone();
    let sid_s = sid.clone();
    let cookies_s = cookies.clone();
    let streamed = if input.resume_ms == 0 {
        tauri::async_runtime::spawn_blocking(move || {
            if ytdlp::is_cached_file(&cache_s, &sid_s) {
                return None;
            }
            ytdlp::stream_audio(&cache_s, &sid_s, cookies_s.as_deref()).ok()
        })
        .await
        .ok()
        .flatten()
    } else {
        None
    };

    if let Some(h) = streamed {
        if PLAY_GEN.load(Ordering::SeqCst) != my_gen {
            return Ok(());
        }
        // ⭐ AKIŞ KURTARMA (v1.8.5): akış yarıda kesilirse şarkıyı ATLAMA —
        // tam dosyayı indirip KALDIĞI SANİYEDEN devam et.
        //
        // Eksik dosyanın sonuna gelen ses motoru bunu "şarkı bitti" sanıp
        // sıradakine geçiyordu; kullanıcının gördüğü "şarkılar 40-45.
        // saniyede kendiliğinden atlıyor" davranışı buydu.
        let done = h.done.clone();
        let failed = h.failed.clone();
        let app_w = app.clone();
        let sid_w = sid.clone();
        let cookies_w = cookies.clone();
        let track_w = input.track_id.clone();
        let dur_w = input.duration_ms;
        let cache_w = cache.clone();
        tauri::async_runtime::spawn(async move {
            // Akışın bitmesini bekle (tamamlandı ya da koptu).
            loop {
                if done.load(Ordering::Relaxed) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
            if !failed.load(Ordering::Relaxed) {
                return; // sorunsuz tamamlandı
            }
            // Kullanıcı bu arada başka şarkıya geçtiyse karışma.
            if PLAY_GEN.load(Ordering::SeqCst) != my_gen {
                return;
            }
            log::info!("akış koptu, tam indirmeye geçiliyor: {sid_w}");
            let sid2 = sid_w.clone();
            let ck = cookies_w.clone();
            let full = tauri::async_runtime::spawn_blocking(move || {
                ytdlp::ensure_audio(&cache_w, &sid2, ck.as_deref())
            })
            .await;
            let Ok(Ok(path)) = full else {
                let _ = app_w.emit("playback-error", "akış kurtarılamadı".to_string());
                return;
            };
            if PLAY_GEN.load(Ordering::SeqCst) != my_gen {
                return;
            }
            // Kaldığı saniyeden devam et (ses motorunun kendi sayacı).
            let pos = app_w
                .try_state::<AudioHandle>()
                .map(|st| st.shared.position_ms.load(Ordering::Relaxed))
                .unwrap_or(0);
            if let Some(st) = app_w.try_state::<AudioHandle>() {
                st.send(AudioCmd::Load {
                    path,
                    duration_ms: dur_w,
                    track_id: track_w,
                    start_ms: pos,
                    fade_ms: 0,
                    growing: None,
                });
            }
        });

        audio.send(AudioCmd::Load {
            path: h.path,
            duration_ms: input.duration_ms,
            track_id: input.track_id,
            start_ms: 0,
            fade_ms: input.fade_ms,
            growing: Some(h.done),
        });
        return Ok(());
    }

    // ⭐ "HER ŞARKI BİR ŞEKİLDE İNSİN" (v1.8.4): tüm indirme katmanları
    // tükendiyse pes etme — aynı şarkının BAŞKA bir yüklemesini bul ve onu
    // indir. Video kaldırılmış/bölge kısıtlı/inatla 403 veriyor olabilir;
    // eskiden bu durumda şarkı sessizce atlanıyordu.
    let title = input.title.clone();
    let artist = input.artist.clone();
    let app_alt = app.clone();
    let track_id_alt = input.track_id.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        match ytdlp::ensure_audio(&cache, &sid, cookies.as_deref()) {
            Ok(p) => Ok(p),
            Err(first_err) => {
                if title.trim().is_empty() {
                    return Err(first_err);
                }
                let Some(alt) = ytdlp::find_alternative(
                    &title,
                    &artist,
                    input.duration_ms,
                    &sid,
                    cookies.as_deref(),
                ) else {
                    return Err(first_err);
                };
                let p = ytdlp::ensure_audio(&cache, &alt.source_id, cookies.as_deref())?;
                // Frontend'e bildir: `tracks` satırındaki kaynak GÜNCELLENSİN,
                // yoksa her çalışta aynı ölü video yeniden denenir.
                let _ = app_alt.emit(
                    "track-relinked",
                    serde_json::json!({
                        "trackId": track_id_alt,
                        "sourceId": alt.source_id,
                        "title": alt.title,
                    }),
                );
                Ok(p)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: anyhow::Error| e.to_string())?;

    // İndirme sürerken daha yeni bir şarkı seçildiyse bu Load'u atla.
    if PLAY_GEN.load(Ordering::SeqCst) != my_gen {
        return Ok(());
    }

    audio.send(AudioCmd::Load {
        path,
        duration_ms: input.duration_ms,
        track_id: input.track_id,
        start_ms: input.resume_ms,
        fade_ms: input.fade_ms,
        growing: None,
    });
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub path: String,
    pub bytes: u64,
    pub format: String,
}

/// Bir parçayı kalıcı olarak indirir (varsa indirmeden döner) ve dosya
/// bilgisini döndürür. DB kaydı (tracks + cache.downloaded=1) frontend'de yapılır.
#[tauri::command]
pub async fn download_audio(
    app: AppHandle,
    source_id: String,
    cookies_browser: Option<String>,
) -> Result<DownloadResult, String> {
    let _permit = dl_semaphore().acquire().await; // eşzamanlılık sınırı
    let cache = audio_cache_dir(&app).map_err(|e| e.to_string())?;
    let sid = source_id.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        ytdlp::ensure_audio(&cache, &sid, cookies_browser.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();
    Ok(DownloadResult {
        path: path.to_string_lossy().to_string(),
        bytes,
        format,
    })
}

/// Bir sonraki şarkıyı arka planda indirip hazırlar (anlık geçiş için).
#[tauri::command]
pub async fn prefetch_audio(
    app: AppHandle,
    source_id: String,
    cookies_browser: Option<String>,
) -> Result<(), String> {
    let _permit = dl_semaphore().acquire().await; // eşzamanlılık sınırı
    let cache = audio_cache_dir(&app).map_err(|e| e.to_string())?;
    let _ = tauri::async_runtime::spawn_blocking(move || {
        ytdlp::ensure_audio(&cache, &source_id, cookies_browser.as_deref())
    })
    .await;
    Ok(())
}

/// İndirilen/önbellekteki dosyayı diskten siler.
#[tauri::command]
pub fn delete_audio(app: AppHandle, source_id: String) -> bool {
    let Ok(dir) = audio_cache_dir(&app) else {
        return false;
    };
    let mut removed = false;
    for ext in ["aac", "mp3", "m4a", "opus", "ogg", "flac", "wav", "webm"] {
        let p = dir.join(format!("{source_id}.{ext}"));
        if p.exists() && std::fs::remove_file(&p).is_ok() {
            removed = true;
        }
    }
    removed
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheFile {
    source_id: String,
    bytes: u64,
}

/// Önbellekteki ses dosyalarını (source_id + boyut) listeler.
#[tauri::command]
pub fn cache_files(app: AppHandle) -> Vec<CacheFile> {
    let Ok(dir) = audio_cache_dir(&app) else {
        return vec![];
    };
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let sid = name.split('.').next().unwrap_or("").to_string();
            if !sid.is_empty() {
                out.push(CacheFile {
                    source_id: sid,
                    bytes: meta.len(),
                });
            }
        }
    }
    out
}

/// ⭐ ÖNBELLEK BUDAMA (LRU) — otomatik boyut sınırı.
///
/// SORUN: çalma sırasında inen her şarkı diske yazılıyor ama `cache` TABLOSUNA
/// KAYDEDİLMİYOR (yalnız kullanıcının açıkça "indir" dediği parçalar oraya
/// girer). Yani geçici dosyaları hiçbir şey takip etmiyordu ve hiçbir şey
/// temizleyemiyordu → ölçüldü: 345 dosya / 1.1 GB.
///
/// ÇÖZÜM: diskten LRU budama. `keep` (kullanıcının indirdikleri) ASLA silinmez;
/// kalanlar en son DEĞİŞTİRİLME zamanına göre sıralanır ve toplam boyut sınırın
/// altına inene kadar en eskiden başlayarak silinir.
///
/// Neden mtime: dosya her çalındığında dokunulmuyor, ama pratikte "en son
/// indirilen" ≈ "en son çalınan" (dosya çalınacağı için indiriliyor). Ayrı bir
/// erişim defteri tutmak her çalmada disk/DB yazması demekti — buna değmez.
#[tauri::command]
pub fn prune_cache(app: AppHandle, keep: Vec<String>, max_bytes: u64) -> ClearResult {
    let keep: std::collections::HashSet<String> = keep.into_iter().collect();
    let mut out = ClearResult {
        deleted_bytes: 0,
        deleted_count: 0,
    };
    if max_bytes == 0 {
        return out; // 0 = sınırsız
    }
    let Ok(dir) = audio_cache_dir(&app) else {
        return out;
    };

    // (değiştirilme, boyut, yol) — korunacaklar hariç.
    let mut items: Vec<(std::time::SystemTime, u64, PathBuf)> = Vec::new();
    let mut total: u64 = 0;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let len = meta.len();
            total += len; // korunanlar da toplama dahil (gerçek disk kullanımı)
            let name = e.file_name().to_string_lossy().to_string();
            let sid = name.split('.').next().unwrap_or("").to_string();
            if sid.is_empty() || keep.contains(&sid) {
                continue;
            }
            let t = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            items.push((t, len, e.path()));
        }
    }
    if total <= max_bytes {
        return out;
    }

    items.sort_by_key(|(t, _, _)| *t); // en eski önce
    for (_, len, path) in items {
        if total <= max_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
            out.deleted_bytes += len;
            out.deleted_count += 1;
        }
    }
    log::info!(
        "önbellek budandı: {} dosya, {} bayt (sınır {} bayt)",
        out.deleted_count,
        out.deleted_bytes,
        max_bytes
    );
    out
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearResult {
    deleted_bytes: u64,
    deleted_count: u64,
}

/// `keep` listesindeki (indirilen) source_id'ler hariç önbelleği siler.
#[tauri::command]
pub fn delete_cache_except(app: AppHandle, keep: Vec<String>) -> ClearResult {
    let keep: std::collections::HashSet<String> = keep.into_iter().collect();
    let Ok(dir) = audio_cache_dir(&app) else {
        return ClearResult {
            deleted_bytes: 0,
            deleted_count: 0,
        };
    };
    let (mut db, mut dc) = (0u64, 0u64);
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let sid = name.split('.').next().unwrap_or("").to_string();
            if sid.is_empty() || keep.contains(&sid) {
                continue;
            }
            if let Ok(meta) = e.metadata() {
                let len = meta.len();
                if std::fs::remove_file(e.path()).is_ok() {
                    db += len;
                    dc += 1;
                }
            }
        }
    }
    ClearResult {
        deleted_bytes: db,
        deleted_count: dc,
    }
}

/// Tüm veriyi (frontend'in oluşturduğu JSON) İndirilenler klasörüne yedekler.
#[tauri::command]
pub fn export_data(app: AppHandle, json: String) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(format!("resonance-yedek-{secs}.json"));
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// --- Veritabanı yedekleme / geri yükleme (veri kaybına karşı güvenlik ağı) ---

fn epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn db_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let cfg = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok((cfg.join("resonance.db"), cfg.join("backups")))
}

fn prune_backups(bdir: &Path, keep: usize) {
    let mut files: Vec<PathBuf> = std::fs::read_dir(bdir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("resonance-") && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    files.sort(); // zaman damgalı ada göre artan
    while files.len() > keep {
        let _ = std::fs::remove_file(files.remove(0));
    }
}

/// Mevcut DB'yi zaman damgalı bir yedeğe kopyalar (son 12 tutulur).
#[tauri::command]
pub fn backup_db(app: AppHandle) -> Result<String, String> {
    let (db, bdir) = db_paths(&app)?;
    if !db.exists() {
        return Err("Veritabanı bulunamadı".into());
    }
    std::fs::create_dir_all(&bdir).map_err(|e| e.to_string())?;
    let dest = bdir.join(format!("resonance-{}.db", epoch_secs()));
    std::fs::copy(&db, &dest).map_err(|e| e.to_string())?;
    prune_backups(&bdir, 12);
    Ok(dest.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    path: String,
    name: String,
    bytes: u64,
    modified_ms: u64,
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Vec<BackupInfo> {
    let Ok((_, bdir)) = db_paths(&app) else {
        return vec![];
    };
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(&bdir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !(name.starts_with("resonance-") && name.ends_with(".db")) {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            let modified = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(BackupInfo {
                path: e.path().to_string_lossy().to_string(),
                name,
                bytes: meta.len(),
                modified_ms: modified,
            });
        }
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms)); // en yeni önce
    out
}

/// Bir yedeği geri yükler: önce mevcut DB'yi yedekler, sonra üzerine kopyalar
/// ve uygulamayı yeniden başlatır (yeni DB yüklensin).
#[tauri::command]
pub fn restore_backup(app: AppHandle, path: String) -> Result<(), String> {
    let (db, _) = db_paths(&app)?;
    let _ = backup_db(app.clone()); // mevcut durumu da koru
    std::fs::copy(&path, &db).map_err(|e| e.to_string())?;
    app.restart()
}

/// Bir şarkının indirilip cache'lenip lenmediğini söyler (hibrit mod göstergeleri için).
#[tauri::command]
pub fn is_cached(app: AppHandle, source_id: String) -> bool {
    audio_cache_dir(&app)
        .ok()
        .and_then(|dir| {
            ["aac", "mp3", "m4a", "opus", "ogg", "flac", "wav", "webm"]
                .iter()
                .map(|ext| dir.join(format!("{source_id}.{ext}")))
                .find(|p| p.exists())
        })
        .is_some()
}

/// İndirme zincirini baştan sona test eder ve okunabilir bir rapor döndürür
/// (Ayarlar → Sorun Giderme). Arayüzde log ekranı olmadığı için Windows'taki
/// "hiçbir şey çalmıyor" durumunun tek teşhis yolu buydu.
#[tauri::command]
pub async fn diagnose_download(
    app: AppHandle,
    cookies_browser: Option<String>,
) -> Result<String, String> {
    let cache = audio_cache_dir(&app).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        ytdlp::diagnose(&cache, cookies_browser.as_deref())
    })
    .await
    .map_err(|e| e.to_string())
}

/// Sıradaki şarkıların adreslerini ARKA PLANDA çöz (dosya indirmez).
///
/// ⭐ Neden ayrı komut: prefetch dosyayı tam indirir ve pahalıdır (ağ + disk),
/// bu yüzden yalnız 2 şarkı için yapılıyor. Oysa URL çözümü ucuz ve asıl
/// bekleme sebebi O: ölçümde şarkı başına ~2.5 sn. Daha çok şarkının adresini
/// önden çözmek, kullanıcı ileri atladığında beklemeyi sıfırlar.
#[tauri::command]
pub async fn prewarm_urls(
    source_ids: Vec<String>,
    cookies_browser: Option<String>,
) -> Result<(), String> {
    if source_ids.is_empty() {
        return Ok(());
    }
    // ⚠️ İNDİRME SEMAFORUNU KULLANMA. Ölçümde 9 şarkının adresi 16 sn sürdü;
    // aynı semaforu paylaşsaydı bu süre boyunca prefetch (gerçek indirme)
    // bloke olurdu ve kullanıcı şarkı geçtiğinde beklerdi. Isıtmanın kendi
    // sınırı var: aynı anda tek tur (üst üste yığılmasın).
    let _permit = prewarm_semaphore().acquire().await;
    tauri::async_runtime::spawn_blocking(move || {
        ytdlp::prewarm_urls(&source_ids, cookies_browser.as_deref());
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessResult {
    pub lufs: f64,
    pub peak_db: f64,
}

/// Önbellekteki ses dosyasının yüksekliğini ölçer (şarkılar arası seviye
/// eşitleme için). Dosya inmemişse hata döner — çağıran taraf sessizce geçer.
#[tauri::command]
pub async fn measure_loudness(
    app: AppHandle,
    source_id: String,
) -> Result<LoudnessResult, String> {
    let cache = audio_cache_dir(&app).map_err(|e| e.to_string())?;
    let (lufs, peak_db) =
        tauri::async_runtime::spawn_blocking(move || ytdlp::measure_loudness(&cache, &source_id))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    Ok(LoudnessResult { lufs, peak_db })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    position_ms: u64,
    duration_ms: u64,
    playing: bool,
    track_id: Option<String>,
}

/// Anlık oynatma durumunu döndürür (UI yeniden bağlandığında senkron için).
#[tauri::command]
pub fn audio_status(audio: State<'_, AudioHandle>) -> AudioStatus {
    let s = &audio.shared;
    AudioStatus {
        position_ms: s.position_ms.load(Ordering::Relaxed),
        duration_ms: s.duration_ms.load(Ordering::Relaxed),
        playing: s.playing.load(Ordering::Relaxed),
        track_id: s.track_id.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub fn audio_play(audio: State<'_, AudioHandle>) {
    audio.send(AudioCmd::Play);
}

#[tauri::command]
pub fn audio_pause(audio: State<'_, AudioHandle>) {
    audio.send(AudioCmd::Pause);
}

#[tauri::command]
pub fn audio_stop(audio: State<'_, AudioHandle>) {
    audio.send(AudioCmd::Stop);
}

#[tauri::command]
pub fn audio_seek(audio: State<'_, AudioHandle>, ms: u64) {
    audio.send(AudioCmd::Seek(ms));
}

#[tauri::command]
pub fn audio_set_volume(audio: State<'_, AudioHandle>, volume: f32) {
    audio.send(AudioCmd::SetVolume(volume));
}

// --- yt-dlp çalışma-anı güncellemesi (eski sidecar'ı geçersiz kılar) ---

/// Güncel yt-dlp ikilisinin tutulduğu dizin (app_config/bin). resolve_bin
/// (ytdlp.rs) bu dizini RESONANCE_YTDLP_DIR env'inden okuyup sidecar'dan önce
/// kullanır.
pub fn ytdlp_bin_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app.path().app_config_dir()?.join("bin");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn ytdlp_target_name() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

/// GitHub'dan en güncel yt-dlp'yi indirip app_config/bin'e yazar. Bir sonraki
/// arama/indirme bunu kullanır. İndirilen sürüm metnini döndürür.
#[tauri::command]
pub async fn update_ytdlp(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<String> {
        let dir = ytdlp_bin_dir(&app)?;
        let url = if cfg!(windows) {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        } else if cfg!(target_os = "macos") {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
        } else {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
        };
        let dest = dir.join(ytdlp_target_name());

        let client = reqwest::blocking::Client::builder()
            .user_agent("Resonance")
            .timeout(std::time::Duration::from_secs(120))
            .build()?;
        let bytes = client.get(url).send()?.error_for_status()?.bytes()?;
        if bytes.len() < 1_000_000 {
            anyhow::bail!("İndirilen dosya beklenenden küçük ({} B)", bytes.len());
        }
        // Önce geçici dosyaya yaz, sonra taşı (kısmi indirme bozmasın).
        let tmp = dir.join("yt-dlp.download");
        std::fs::write(&tmp, &bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
        }
        // Windows: hedef varsa rename hata verir → önce kaldır.
        if dest.exists() {
            let _ = std::fs::remove_file(&dest);
        }
        std::fs::rename(&tmp, &dest)?;
        log::info!("yt-dlp güncellendi: {}", dest.display());

        // Sürümü öğren (kısa).
        // ⚠️ Windows: bu çağrı `no_window` almadığı için güncelleme sırasında
        // ekrana bir konsol penceresi fırlıyordu.
        let mut vc = std::process::Command::new(&dest);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            vc.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let ver = vc
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        Ok(ver)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Uygulama log dosyasının son satırlarını döndürür (Ayarlar → Hata Günlüğü).
#[tauri::command]
pub fn read_log(app: AppHandle, lines: Option<usize>) -> Result<String, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let mut logs: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("log"))
        .collect();
    logs.sort();
    let path = logs
        .last()
        .ok_or_else(|| "Henüz log dosyası yok.".to_string())?;
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let n = lines.unwrap_or(300);
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(n);
    Ok(all[start..].join("\n"))
}
