//! Webview `localStorage`'ının KALICI YEDEĞİ — yalnız birkaç kritik anahtar.
//!
//! ⛔ NEDEN (v1.9.3, ölçüldü): Mac'te `device_queue` tablosunda aynı makineye
//! ait DÖRT farklı cihaz kimliği vardı (08-24 iki kez, 09-09, 09-15). Kimlik
//! ve Supabase oturumu `localStorage`'da duruyordu; WebKit veri klasörü
//! (`~/Library/WebKit/com.resonance.app`) bir işletim sistemi güncellemesinde
//! sıfırdan oluşmuştu. Sonuç: her sıfırlamada (1) uygulama yeni bir "Mac"
//! olarak görünüyor — Keşfet'in "Başka cihaz" listesinde 3 ayrı Mac — ve
//! (2) oturum düştüğü için kullanıcı yeniden giriş yapmak zorunda kalıyordu.
//!
//! Bu dosya uygulamanın kendi yapılandırma klasöründe (`webstore.json`) durur;
//! webview verisi silinse bile açılışta geri yüklenir.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

static LOCK: Mutex<()> = Mutex::new(());

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("webstore.json"))
}

fn read_map(path: &PathBuf) -> HashMap<String, String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn durable_load(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(read_map(&store_path(&app)?))
}

/// `None` değer anahtarı siler (oturumdan çıkış).
#[tauri::command]
pub fn durable_save(
    app: AppHandle,
    entries: HashMap<String, Option<String>>,
) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = store_path(&app)?;
    let mut map = read_map(&path);
    for (k, v) in entries {
        match v {
            Some(v) => {
                map.insert(k, v);
            }
            None => {
                map.remove(&k);
            }
        }
    }
    let json = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    // Yarım yazılmış dosya oturumu bozmasın: önce geçici dosya, sonra değiştir.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    if path.exists() {
        let _ = std::fs::remove_file(&path); // Windows'ta rename hedefi varsa hata verir
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Oturum jetonu içeriyor → yalnız kullanıcı okuyabilsin.
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}
