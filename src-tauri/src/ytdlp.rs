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

// cookies: kullanıcının Ayarlar'da seçtiği tarayıcı (ör. "safari", "chrome").
// Verilirse --cookies-from-browser eklenir → YouTube girişiyle tam playlist
// (>100 öğe) ve özel listelere erişim + bot engellerini azaltma.
fn yt_dlp(cookies: Option<&str>) -> Command {
    let mut c = Command::new("yt-dlp");
    c.env("PATH", augmented_path());
    if let Some(b) = cookies {
        if !b.is_empty() {
            // Opera GX ayrı bir profil dizininde durur; yt-dlp "opera" tipiyle
            // birlikte o yolu vererek bulmasını sağlıyoruz.
            let arg = if b == "opera-gx" {
                match std::env::var_os("HOME") {
                    Some(home) => format!(
                        "opera:{}/Library/Application Support/com.operasoftware.OperaGX",
                        home.to_string_lossy()
                    ),
                    None => "opera".to_string(),
                }
            } else {
                b.to_string()
            };
            c.args(["--cookies-from-browser", &arg]);
        }
    }
    c
}

/// YouTube'da arama yapar ve düz (flat) sonuç listesi döndürür.
pub fn search(
    query: &str,
    limit: u32,
    cookies: Option<&str>,
) -> anyhow::Result<Vec<SearchResult>> {
    let spec = format!("ytsearch{}:{}", limit.max(1).min(50), query);
    let out = yt_dlp(cookies)
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
    pub total: u64, // listenin gerçek şarkı sayısı (yt-dlp playlist_count)
}

/// Bir YouTube / YouTube Music çalma listesi URL'inden başlık + şarkıları çıkarır.
pub fn playlist_meta(url: &str, cookies: Option<&str>) -> anyhow::Result<PlaylistMeta> {
    let out = yt_dlp(cookies)
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
    let mut c = Command::new("ffmpeg");
    c.env("PATH", augmented_path());
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

    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let dl_tmpl = cache_dir.join(format!("{video_id}.src.%(ext)s"));

    let status = yt_dlp(cookies)
        .args([
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            "-N",
            "4", // paralel parça indirme — daha hızlı
            "--no-playlist",
            "--no-warnings",
            "--no-part",
            "-o",
            dl_tmpl.to_str().unwrap(),
            "--",
            &url,
        ])
        .status()?;
    if !status.success() {
        anyhow::bail!("yt-dlp ses indirme başarısız ({video_id})");
    }

    let src = find_src(cache_dir, video_id)
        .ok_or_else(|| anyhow::anyhow!("indirilen kaynak bulunamadı ({video_id})"))?;
    let target = cache_dir.join(format!("{video_id}.aac"));

    // 1) Hızlı yol: AAC akışını kopyalayarak ADTS'ye remux et.
    let copied = ffmpeg()
        .args([
            "-y",
            "-v",
            "error",
            "-i",
            src.to_str().unwrap(),
            "-c:a",
            "copy",
            "-f",
            "adts",
            target.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    // 2) Kaynak AAC değilse (opus/webm) aac'ye transcode et.
    if !copied || !target.exists() {
        let _ = std::fs::remove_file(&target);
        ffmpeg()
            .args([
                "-y",
                "-v",
                "error",
                "-i",
                src.to_str().unwrap(),
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-f",
                "adts",
                target.to_str().unwrap(),
            ])
            .status()?;
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
