// Frontend'e açılan Tauri komutları: arama + oynatma kontrolü.

use std::path::PathBuf;
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
        let token = spotify::get_token(&client_id, &client_secret)?;
        let (name, sp_tracks) = spotify::fetch_playlist(&token, &pid)?;
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

#[tauri::command]
pub async fn play_track(
    app: AppHandle,
    audio: State<'_, AudioHandle>,
    input: PlayInput,
    cookies_browser: Option<String>,
) -> Result<(), String> {
    let _ = app.emit("playback-loading", &input.track_id);

    let cache = audio_cache_dir(&app).map_err(|e| e.to_string())?;
    let sid = input.source_id.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        ytdlp::ensure_audio(&cache, &sid, cookies_browser.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    audio.send(AudioCmd::Load {
        path,
        duration_ms: input.duration_ms,
        track_id: input.track_id,
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
