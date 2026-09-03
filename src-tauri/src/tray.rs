// ⭐ MENÜ ÇUBUĞU OYNATICISI (v1.9.0)
//
// Kullanıcının isteği: "mac'te küçük oynatıcı yerine üstteki çubuğa gelsin;
// ana pencereyi kapatıp arka planda mini oynatıcıyla takılabilelim."
//
// Yaptığı iş:
//  • Menü çubuğunda (Windows'ta sistem tepsisinde) bir simge ve menü.
//  • Simgeye SOL tık → mini oynatıcı paneli simgenin ALTINDA açılır/kapanır.
//  • Ana pencere kapatılınca uygulama ÇIKMAZ, yalnız gizlenir (lib.rs) —
//    müzik çalmaya devam eder, dönüş yolu hep burada.
//  • Menüde Çıkış var: tepsi simgesi olduğu için uygulama artık "görünmez
//    biçimde açık kalma" riskine girmiyor.
//
// ⚠️ Menü eylemleri Rust'ta İŞLENMEZ: `mini-command` olayı yayınlanır ve ANA
// pencere uygular (kuyruk mantığı, oy kaydı, öneri beslemesi orada). Mini
// oynatıcı da aynı sözleşmeyi kullanıyor (src/lib/miniPlayer.ts).
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub const TRAY_ID: &str = "player";

/// Mini panelin mantıksal boyu (src/lib/miniPlayer.ts ile aynı olmalı).
const PANEL_W: f64 = 372.0;
const PANEL_H: f64 = 152.0;

#[derive(Clone, serde::Serialize)]
struct Cmd {
    action: &'static str,
}

fn send(app: &AppHandle, action: &'static str) {
    let _ = app.emit("mini-command", Cmd { action });
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let items = [
        MenuItem::with_id(app, "toggle", "Oynat / Duraklat", true, None::<&str>)?,
        MenuItem::with_id(app, "prev", "Önceki", true, None::<&str>)?,
        MenuItem::with_id(app, "next", "Sonraki", true, None::<&str>)?,
    ];
    let sep = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "Ana pencereyi göster", true, None::<&str>)?;
    let panel = MenuItem::with_id(app, "panel", "Mini oynatıcı", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &items[0], &items[1], &items[2], &sep, &panel, &show, &sep, &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Resonance")
        .menu(&menu)
        // Sol tık menüyü DEĞİL paneli açsın (menü sağ tıkta).
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => send(app, "toggle"),
            "prev" => send(app, "prev"),
            "next" => send(app, "next"),
            "show" => send(app, "showMain"),
            "panel" => toggle_panel(app, None),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                toggle_panel(tray.app_handle(), Some(position));
            }
        });
    // ⚠️ Menü çubuğu simgesi uygulama ikonu OLMAZ: macOS'ta tek renk (template)
    // beklenir, renkli ikon orada boş bir kare gibi görünüyordu. `tray.png`
    // logonun 7 çubuğunun tek renk hâli (yalnız alfa taşır).
    match tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")) {
        Ok(icon) => {
            builder = builder.icon(icon);
            #[cfg(target_os = "macos")]
            {
                builder = builder.icon_as_template(true);
            }
        }
        Err(e) => {
            log::warn!("tepsi simgesi okunamadı ({e}) — uygulama ikonu kullanılıyor");
            if let Some(icon) = app.default_window_icon().cloned() {
                builder = builder.icon(icon);
            }
        }
    }
    builder.build(app)?;
    Ok(())
}

/// Menü çubuğundaki metni günceller (macOS'ta simgenin yanında görünür).
pub fn set_title(app: &AppHandle, text: Option<String>) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(text);
    }
}

/// Mini paneli aç/kapat. `near` verilirse panel o noktanın altına konumlanır
/// (menü çubuğu simgesinin altı).
fn toggle_panel(app: &AppHandle, near: Option<tauri::PhysicalPosition<f64>>) {
    if let Some(win) = app.get_webview_window("mini") {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            let _ = win.hide();
        } else {
            place(&win, near);
            let _ = win.show();
            let _ = win.set_focus();
        }
        return;
    }
    // Pencere yoksa kur (mini oynatıcının kendisiyle aynı yapılandırma).
    let built = tauri::WebviewWindowBuilder::new(
        app,
        "mini",
        tauri::WebviewUrl::App("index.html?mini=1".into()),
    )
    .title("Resonance")
    .inner_size(PANEL_W, PANEL_H)
    .resizable(false)
    .always_on_top(true)
    .decorations(false)
    .accept_first_mouse(true)
    .skip_taskbar(true)
    .visible(false)
    .build();
    match built {
        Ok(win) => {
            place(&win, near);
            let _ = win.show();
            let _ = win.set_focus();
        }
        Err(e) => log::warn!("mini panel açılamadı: {e}"),
    }
}

fn place(win: &tauri::WebviewWindow, near: Option<tauri::PhysicalPosition<f64>>) {
    let Some(p) = near else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let w = PANEL_W * scale;
    // Simgenin altına, yatayda ortalanmış.
    let mut x = p.x - w / 2.0;
    if x < 0.0 {
        x = 0.0;
    }
    // Ekranın sağından taşmasın.
    if let Ok(Some(mon)) = win.current_monitor() {
        let max_x = mon.position().x as f64 + mon.size().width as f64 - w - 8.0;
        if x > max_x {
            x = max_x;
        }
    }
    let y = p.y + 8.0 * scale;
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}
