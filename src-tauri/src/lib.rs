mod audio;
mod commands;
#[cfg(desktop)]
mod media_controls;
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
        Migration {
            version: 4,
            description: "add_recommendation_history",
            kind: MigrationKind::Up,
            // Önerilen parçaların KALICI günlüğü: uygulama kapatılıp açılınca bile
            // aynı öneriler tekrar gelmesin diye. Yakın zamanda önerilenler
            // öneri havuzundan dışlanır (recommender.ts).
            sql: "CREATE TABLE IF NOT EXISTS recommendation_history (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    track_id       TEXT NOT NULL,
                    recommended_at INTEGER NOT NULL
                  );
                  CREATE INDEX IF NOT EXISTS idx_rechist_track ON recommendation_history(track_id);
                  CREATE INDEX IF NOT EXISTS idx_rechist_at ON recommendation_history(recommended_at);",
        },
        Migration {
            version: 5,
            description: "sync_scaffolding",
            kind: MigrationKind::Up,
            // ⭐ BULUT SENKRONU (v1.3.0) için şema hazırlığı. Üç şey ekler:
            //
            // 1) `updated_at` + `deleted` (tombstone) — satır bazlı LWW
            //    (last-write-wins) birleştirme. SİLME ARTIK KALICI DEĞİL:
            //    `deleted=1` işaretlenir, çünkü hard delete diğer cihaza
            //    "bu satır hiç yoktu" gibi görünür ve silinen satır geri gelir.
            //    ⛔ Bu yüzden TÜM okumalara `deleted = 0` filtresi ŞART.
            //
            // 2) `uid` + `device_id` — votes/play_history/recommendation_history
            //    AUTOINCREMENT id kullanıyor; iki cihaz KAÇINILMAZ olarak aynı
            //    id'yi üretir ve buluta yazarken birbirini ezerdi. `uid` cihazdan
            //    bağımsız benzersiz kimliktir (idempotent upsert anahtarı).
            //
            // 3) `sync_state` — tablo başına push/pull su terazisi (watermark).
            //
            // Eski satırlar: updated_at = 0 kalırsa ilk senkronda "çok eski"
            // sayılıp uzaktaki her şeye yenilir → mevcut zaman damgalarından
            // DOLDURULUR. uid boş kalırsa senkronlanamaz → rastgele üretilir
            // (randomblob satır başına yeniden hesaplanır, çakışma olmaz).
            sql: r#"
                ALTER TABLE playlists       ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE playlists       ADD COLUMN deleted    INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE playlist_tracks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE playlist_tracks ADD COLUMN deleted    INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE tracks          ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

                UPDATE playlists       SET updated_at = created_at WHERE updated_at = 0;
                UPDATE playlist_tracks SET updated_at = added_at   WHERE updated_at = 0;
                UPDATE tracks          SET updated_at = added_at   WHERE updated_at = 0;

                -- Olay günlükleri append-only'dir AMA `undoVote` bir oyu geri alır.
                -- Bu da tombstone olmalı (hard delete senkronda "hiç olmadı"ya
                -- eşittir → oy diğer cihazdan geri gelir). Tombstone `created_at`i
                -- değiştirmediği için push penceresi onu göremez → üç tabloya da
                -- ayrı `updated_at` gerekir (tek tip motor, tek kod yolu).
                ALTER TABLE votes                  ADD COLUMN uid        TEXT;
                ALTER TABLE votes                  ADD COLUMN device_id  TEXT;
                ALTER TABLE votes                  ADD COLUMN deleted    INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE votes                  ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE play_history           ADD COLUMN uid        TEXT;
                ALTER TABLE play_history           ADD COLUMN device_id  TEXT;
                ALTER TABLE play_history           ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE recommendation_history ADD COLUMN uid        TEXT;
                ALTER TABLE recommendation_history ADD COLUMN device_id  TEXT;
                ALTER TABLE recommendation_history ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

                UPDATE votes                  SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
                UPDATE play_history           SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;
                UPDATE recommendation_history SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;

                UPDATE votes                  SET updated_at = created_at     WHERE updated_at = 0;
                UPDATE play_history           SET updated_at = played_at      WHERE updated_at = 0;
                UPDATE recommendation_history SET updated_at = recommended_at WHERE updated_at = 0;

                CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_uid   ON votes(uid);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_hist_uid    ON play_history(uid);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_rechist_uid ON recommendation_history(uid);

                -- Push sorgusu "updated_at > watermark" ile tarar → indeks şart.
                CREATE INDEX IF NOT EXISTS idx_playlists_upd ON playlists(updated_at);
                CREATE INDEX IF NOT EXISTS idx_pt_upd        ON playlist_tracks(updated_at);
                CREATE INDEX IF NOT EXISTS idx_tracks_upd    ON tracks(updated_at);
                CREATE INDEX IF NOT EXISTS idx_votes_upd     ON votes(updated_at);
                CREATE INDEX IF NOT EXISTS idx_hist_upd      ON play_history(updated_at);
                CREATE INDEX IF NOT EXISTS idx_rechist_upd   ON recommendation_history(updated_at);

                CREATE TABLE IF NOT EXISTS sync_state (
                    table_name  TEXT PRIMARY KEY,
                    last_pulled TEXT    NOT NULL DEFAULT '',  -- sunucu synced_at (ISO)
                    last_pushed INTEGER NOT NULL DEFAULT 0    -- yerel updated_at (epoch ms)
                );
            "#,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Tek örnek (single instance) — TÜM masaüstü build'lerinde (debug dahil).
    // İki kopyanın aynı SQLite DB'sinde yarışıp veri bozmasını önler.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }));
        // Windows açılışında otomatik başlatma (Ayarlar'dan aç/kapa).
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
        // Global kısayollar (medya tuşları: kulaklık/klavye oynat-geç-duraklat).
        builder =
            builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:resonance.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::search_youtube,
            commands::music_radio,
            commands::music_genre_pool,
            commands::import_playlist,
            commands::import_spotify,
            commands::get_lyrics,
            commands::play_track,
            commands::download_audio,
            commands::prefetch_audio,
            commands::delete_audio,
            commands::is_cached,
            commands::cache_files,
            commands::delete_cache_except,
            commands::prune_cache,
            commands::export_data,
            commands::backup_db,
            commands::list_backups,
            commands::restore_backup,
            commands::audio_status,
            commands::audio_play,
            commands::audio_pause,
            commands::audio_stop,
            commands::audio_seek,
            commands::audio_set_volume,
            commands::update_ytdlp,
            commands::read_log,
            #[cfg(desktop)]
            media_controls::media_set_metadata,
            #[cfg(desktop)]
            media_controls::media_set_playback,
        ])
        .setup(|app| {
            // Log'u her build'de aç (release dahil): Windows indirme/çalma
            // sorunlarının teşhisi için log dosyası şart. Dosya:
            // Windows  %APPDATA%\com.resonance.app\logs\
            // macOS    ~/Library/Logs/com.resonance.app/
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            // Çalışma-anı yt-dlp dizinini ayarla (resolve_bin sidecar'dan önce
            // burayı kullanır). İlk açılışta güncel yt-dlp yoksa arka planda indir.
            if let Ok(bin) = commands::ytdlp_bin_dir(&app.handle().clone()) {
                std::env::set_var("RESONANCE_YTDLP_DIR", &bin);
                let exe = bin.join(if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" });
                if !exe.exists() {
                    let h = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        match commands::update_ytdlp(h).await {
                            Ok(v) => log::info!("yt-dlp ilk indirme tamam: {v}"),
                            Err(e) => log::error!("yt-dlp ilk indirme başarısız: {e}"),
                        }
                    });
                }
            }

            // Ses motorunu başlat ve yönetilen duruma ekle.
            let audio = audio::start(app.handle().clone());
            app.manage(audio);

            // OS medya oturumu (macOS Now Playing / Windows SMTC).
            // Global hotkey'in yakalayamadığı medya tuşlarını çözer + kilit
            // ekranında şarkı bilgisi gösterir. Kurulamazsa uygulama normal çalışır.
            #[cfg(desktop)]
            media_controls::init(&app.handle().clone());

            // ÇERÇEVESİZ PENCERE — YALNIZ WINDOWS'ta.
            // macOS'ta tauri.conf'daki titleBarStyle:Overlay + hiddenTitle zaten
            // çerçevesiz görünüm veriyor (trafik ışıkları içerikte yüzüyor).
            // Windows'ta o ayarların etkisi yok → başlık çubuğu duruyordu. Burada
            // dekorasyonu kaldırıyoruz; min/maks/kapat butonlarını frontend çiziyor
            // (App.tsx WindowControls). GÜVENLİK AĞI: Alt+F4 dekorasyonsuz da
            // çalışır, yani kapat butonu bozulsa bile pencere kapatılabilir.
            #[cfg(windows)]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_decorations(false);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
