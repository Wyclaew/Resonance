// Frontend'e açılan Tauri komutları: arama + oynatma kontrolü.

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::audio::{AudioCmd, AudioHandle};
use crate::ytdlp::{self, SearchResult};

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
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(20);
    tauri::async_runtime::spawn_blocking(move || ytdlp::search(&query, limit))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn play_track(
    app: AppHandle,
    audio: State<'_, AudioHandle>,
    input: PlayInput,
) -> Result<(), String> {
    let _ = app.emit("playback-loading", &input.track_id);

    let cache = audio_cache_dir(&app).map_err(|e| e.to_string())?;
    let sid = input.source_id.clone();
    let path = tauri::async_runtime::spawn_blocking(move || ytdlp::ensure_audio(&cache, &sid))
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
) -> Result<DownloadResult, String> {
    let cache = audio_cache_dir(&app).map_err(|e| e.to_string())?;
    let sid = source_id.clone();
    let path = tauri::async_runtime::spawn_blocking(move || ytdlp::ensure_audio(&cache, &sid))
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

/// İndirilen/önbellekteki dosyayı diskten siler.
#[tauri::command]
pub fn delete_audio(app: AppHandle, source_id: String) -> bool {
    let Ok(dir) = audio_cache_dir(&app) else {
        return false;
    };
    let mut removed = false;
    for ext in ["mp3", "m4a", "aac", "flac", "ogg", "wav", "webm"] {
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
            ["m4a", "mp3", "aac", "flac", "ogg", "wav", "webm"]
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
