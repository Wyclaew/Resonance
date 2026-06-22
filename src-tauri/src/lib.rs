mod audio;
mod commands;
mod spotify;
mod ytdlp;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

// SQLite şeması. Plan'daki veri modeli (tracks, playlists, votes,
// play_history, cache, settings) burada tanımlı. Migration'lar uygulama
// ilk DB bağlantısında (frontend Database.load) çalışır.
fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_initial_schema",
        kind: MigrationKind::Up,
        sql: r#"
            CREATE TABLE IF NOT EXISTS tracks (
                id          TEXT PRIMARY KEY,       -- "source:source_id"
                source      TEXT NOT NULL,          -- 'youtube' | 'local'
                source_id   TEXT NOT NULL,
                title       TEXT NOT NULL,
                artist      TEXT NOT NULL DEFAULT '',
                album       TEXT,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                thumbnail   TEXT,
                added_at    INTEGER NOT NULL        -- epoch ms
            );

            CREATE TABLE IF NOT EXISTS playlists (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT,
                source      TEXT NOT NULL DEFAULT 'local', -- 'local' | 'spotify' | 'ytmusic'
                source_url  TEXT,
                created_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                position    INTEGER NOT NULL DEFAULT 0,
                added_at    INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, track_id)
            );
            CREATE INDEX IF NOT EXISTS idx_pt_playlist ON playlist_tracks(playlist_id, position);

            -- Oy olay günlüğü: öğrenen algoritmanın ve karma decay'in kaynağı.
            -- Her oy aksiyonu (zaman bağlamıyla) buraya eklenir.
            CREATE TABLE IF NOT EXISTS votes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id    TEXT NOT NULL,
                playlist_id TEXT,
                value       INTEGER NOT NULL,       -- -1 | 0 | +1
                created_at  INTEGER NOT NULL,       -- epoch ms
                hour        INTEGER NOT NULL,       -- 0..23 (yerel)
                dow         INTEGER NOT NULL         -- 0..6 (0=Pazar)
            );
            CREATE INDEX IF NOT EXISTS idx_votes_track ON votes(track_id);
            CREATE INDEX IF NOT EXISTS idx_votes_ctx ON votes(hour, dow);
            CREATE INDEX IF NOT EXISTS idx_votes_pt ON votes(playlist_id, track_id);

            -- Oynatma geçmişi: bağlamsal öğrenme için (ne zaman ne dinlendi).
            CREATE TABLE IF NOT EXISTS play_history (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id  TEXT NOT NULL,
                played_at INTEGER NOT NULL,
                ms_played INTEGER NOT NULL DEFAULT 0,
                hour      INTEGER NOT NULL,
                dow       INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_hist_track ON play_history(track_id);
            CREATE INDEX IF NOT EXISTS idx_hist_ctx ON play_history(hour, dow);

            -- İndirilmiş/önbelleğe alınmış ses dosyaları (hibrit mod).
            CREATE TABLE IF NOT EXISTS cache (
                track_id    TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
                file_path   TEXT NOT NULL,
                bytes       INTEGER NOT NULL DEFAULT 0,
                format      TEXT,
                last_played INTEGER
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            );
        "#,
        },
        Migration {
            version: 2,
            description: "add_downloaded_flag",
            kind: MigrationKind::Up,
            // downloaded=1: kullanıcının açıkça indirdiği (kalıcı) parça.
            // downloaded=0: yalnızca oynatma için geçici önbellek.
            sql: "ALTER TABLE cache ADD COLUMN downloaded INTEGER NOT NULL DEFAULT 0;",
        },
        Migration {
            version: 3,
            description: "add_current_vote",
            kind: MigrationKind::Up,
            // Güncel oy durumu (Reddit oklarının açık/kapalı hali). Karma skoru
            // ayrıca `votes` olay günlüğünden (zaman decay'li) hesaplanır.
            sql: "ALTER TABLE playlist_tracks ADD COLUMN vote INTEGER NOT NULL DEFAULT 0;",
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Tek örnek (single instance) yalnızca masaüstünde — ilk plugin olmalı.
    #[cfg(all(desktop, not(debug_assertions)))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:resonance.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::search_youtube,
            commands::import_playlist,
            commands::import_spotify,
            commands::play_track,
            commands::download_audio,
            commands::prefetch_audio,
            commands::delete_audio,
            commands::is_cached,
            commands::audio_status,
            commands::audio_play,
            commands::audio_pause,
            commands::audio_stop,
            commands::audio_seek,
            commands::audio_set_volume,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Ses motorunu başlat ve yönetilen duruma ekle.
            let audio = audio::start(app.handle().clone());
            app.manage(audio);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
