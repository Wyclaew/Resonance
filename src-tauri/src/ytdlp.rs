// yt-dlp sarmalayıcı: YouTube arama + ses indirme.
// Ses, symphonia'nın güvenilir çözebildiği m4a/AAC olarak indirilir
// (gerekirse ffmpeg ile bir kez remux/transcode edilir) ve cache'lenir.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

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
    let extra = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
    match std::env::var("PATH") {
        Ok(p) if !p.is_empty() => format!("{extra}:{p}"),
        _ => extra.to_string(),
    }
}

fn yt_dlp() -> Command {
    let mut c = Command::new("yt-dlp");
    c.env("PATH", augmented_path());
    c
}

/// YouTube'da arama yapar ve düz (flat) sonuç listesi döndürür.
pub fn search(query: &str, limit: u32) -> anyhow::Result<Vec<SearchResult>> {
    let spec = format!("ytsearch{}:{}", limit.max(1).min(50), query);
    let out = yt_dlp()
        .args([
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            "--ignore-errors",
            &spec,
        ])
        .output()?;

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
            results.push(r);
        }
    }
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
}

/// Bir YouTube / YouTube Music çalma listesi URL'inden başlık + şarkıları çıkarır.
pub fn playlist_meta(url: &str) -> anyhow::Result<PlaylistMeta> {
    let out = yt_dlp()
        .args([
            "--flat-playlist",
            "--dump-single-json",
            "--no-warnings",
            "--ignore-errors",
            url,
        ])
        .output()?;

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
    Ok(PlaylistMeta { title, tracks })
}

/// Videonun sesini cache'e indirir (varsa indirmeden döner). Yol döndürür.
pub fn ensure_audio(cache_dir: &Path, video_id: &str) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(cache_dir)?;
    if let Some(p) = find_cached(cache_dir, video_id) {
        return Ok(p);
    }

    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let out_tmpl = cache_dir.join(format!("{video_id}.%(ext)s"));

    // mp3'e dönüştürüyoruz: rodio/symphonia mp3'ü güvenilir çözer (m4a/MP4
    // başlatmada panikliyor) ve bu, opus dahil tüm YouTube formatlarını
    // tek tip hale getirir. Tek seferlik dönüşüm; sonuç cache'lenir.
    let status = yt_dlp()
        .args([
            "-f",
            "bestaudio/best",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0", // LAME V0 (~245 kbps VBR)
            "--no-playlist",
            "--no-warnings",
            "-o",
            out_tmpl.to_str().unwrap(),
            "--",
            &url,
        ])
        .status()?;

    if !status.success() {
        anyhow::bail!("yt-dlp ses indirme başarısız ({video_id})");
    }

    find_cached(cache_dir, video_id)
        .ok_or_else(|| anyhow::anyhow!("indirilen ses dosyası bulunamadı ({video_id})"))
}

fn find_cached(cache_dir: &Path, video_id: &str) -> Option<PathBuf> {
    // mp3 önce: standart indirme biçimimiz bu.
    let exts = ["mp3", "m4a", "aac", "flac", "ogg", "wav", "webm"];
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
