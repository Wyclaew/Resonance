// İşletim sisteminin MEDYA OTURUMU entegrasyonu (souvlaki).
//
// NEDEN GEREKLİ — global-shortcut yaklaşımı yetersizdi:
//  • macOS: F7/F9 normal tuş DEĞİL; `NX_KEYTYPE_NEXT/PREVIOUS` sistem olayı
//    gönderirler ve macOS bunları doğrudan "Now Playing" uygulamasına yönlendirir.
//    Global hotkey bunları hiç görmez. (F8 çalışıyordu çünkü `MediaPlayPause`
//    global-shortcut ile eşleşiyor — diğer ikisi eşleşmiyor.)
//  • Windows: tam ekran bir oyun RAW INPUT aldığında global hotkey'ler
//    tetiklenmez. (Video oynatıcı raw input almadığı için orada çalışıyordu.)
//
// Doğru yol her iki platformda da OS'un kendi medya oturumu API'si:
//  • macOS  → MPRemoteCommandCenter + MPNowPlayingInfoCenter
//  • Windows → SMTC (System Media Transport Controls)
// souvlaki bunu tek arayüzde topluyor. Yan fayda: kilit ekranı / Control Center /
// Windows medya OSD'sinde şarkı adı + sanatçı görünür (Spotify'daki gibi).
//
// ⚠️ macOS: MediaControls bir AppDelegate/event loop ister — Tauri'de var.
// ⚠️ Windows: HWND ister — ana pencereden alınır.

use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
#[cfg(target_os = "windows")]
use tauri::Manager; // get_webview_window — yalnız SMTC'nin HWND'si için

// Tek örnek; komutlar buradan güncelliyor.
static CONTROLS: Mutex<Option<MediaControls>> = Mutex::new(None);

/// Frontend'e giden medya komutu ("media-control" olayı).
/// Değerler usePlayerStore'daki işleyiciyle eşleşmeli.
fn event_name(e: &MediaControlEvent) -> Option<&'static str> {
    match e {
        MediaControlEvent::Play => Some("play"),
        MediaControlEvent::Pause => Some("pause"),
        MediaControlEvent::Toggle => Some("toggle"),
        MediaControlEvent::Next => Some("next"),
        MediaControlEvent::Previous => Some("previous"),
        MediaControlEvent::Stop => Some("stop"),
        _ => None, // Seek/SetPosition/OpenUri vb. — şimdilik kullanılmıyor
    }
}

/// Açılışta bir kez çağrılır (lib.rs setup).
pub fn init(app: &AppHandle) {
    // Windows'ta SMTC pencere tutamacı ister.
    #[cfg(target_os = "windows")]
    let hwnd = {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        match app.get_webview_window("main") {
            Some(w) => match w.window_handle().map(|h| h.as_raw()) {
                Ok(RawWindowHandle::Win32(h)) => Some(h.hwnd.get() as *mut std::ffi::c_void),
                _ => {
                    log::warn!("medya oturumu: HWND alınamadı, SMTC kurulmadı");
                    return;
                }
            },
            None => return,
        }
    };
    #[cfg(not(target_os = "windows"))]
    let hwnd = None;

    let config = PlatformConfig {
        dbus_name: "resonance",
        display_name: "Resonance",
        hwnd,
    };

    let mut controls = match MediaControls::new(config) {
        Ok(c) => c,
        Err(e) => {
            // Kritik değil: medya oturumu kurulamazsa uygulama normal çalışır,
            // yalnız kilit ekranı/medya tuşu entegrasyonu olmaz.
            log::warn!("medya oturumu kurulamadı: {e:?}");
            return;
        }
    };

    let handle = app.clone();
    if let Err(e) = controls.attach(move |event: MediaControlEvent| {
        if let Some(name) = event_name(&event) {
            let _ = handle.emit("media-control", name);
        }
    }) {
        log::warn!("medya oturumu bağlanamadı: {e:?}");
        return;
    }

    *CONTROLS.lock().unwrap() = Some(controls);
    log::info!("medya oturumu kuruldu (OS medya tuşları + kilit ekranı)");
}

/// Çalan parçanın bilgisi — kilit ekranı / Control Center / Windows OSD'de görünür.
#[tauri::command]
pub fn media_set_metadata(title: String, artist: String, album: String, art_url: String) {
    if let Some(c) = CONTROLS.lock().unwrap().as_mut() {
        let _ = c.set_metadata(MediaMetadata {
            title: Some(&title),
            artist: Some(&artist),
            album: if album.is_empty() { None } else { Some(&album) },
            cover_url: if art_url.is_empty() { None } else { Some(&art_url) },
            ..Default::default()
        });
    }
}

/// Oynatma durumu — OS'un oynat/duraklat ikonunu doğru gösterir.
#[tauri::command]
pub fn media_set_playback(playing: bool, stopped: bool) {
    if let Some(c) = CONTROLS.lock().unwrap().as_mut() {
        let state = if stopped {
            MediaPlayback::Stopped
        } else if playing {
            MediaPlayback::Playing { progress: None }
        } else {
            MediaPlayback::Paused { progress: None }
        };
        let _ = c.set_playback(state);
    }
}
