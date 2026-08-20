mod audio;
mod commands;
#[cfg(desktop)]
mod media_controls;
mod spotify;
mod native_dl;
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
        Migration {
            version: 6,
            description: "now_playing",
            kind: MigrationKind::Up,
            // ⭐ CİHAZLAR ARASI "KALDIĞIN YERDEN DEVAM" (v1.6.0).
            //
            // Her cihaz KENDİ satırını yazar (anahtar = device_id) → çakışma
            // yapısı gereği yok; LWW zaten doğru sonucu verir. Tek ortak tablo
            // (ör. "son çalan") olsaydı iki cihaz sürekli birbirini ezerdi.
            //
            // `settings.resumeState` YERİNE ayrı tablo: settings BİLEREK
            // senkronlanmıyor (içinde cihaz kimliği, ses seviyesi, Keşfet
            // kuyruğu var). Bu tablo ise senkronlanır.
            sql: "CREATE TABLE IF NOT EXISTS now_playing (
                    device_id   TEXT PRIMARY KEY,
                    device_name TEXT,
                    track_id    TEXT,
                    source_id   TEXT,
                    title       TEXT,
                    artist      TEXT,
                    thumbnail   TEXT,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    position_ms INTEGER NOT NULL DEFAULT 0,
                    playing     INTEGER NOT NULL DEFAULT 0,
                    updated_at  INTEGER NOT NULL DEFAULT 0,
                    deleted     INTEGER NOT NULL DEFAULT 0
                  );
                  CREATE INDEX IF NOT EXISTS idx_np_upd ON now_playing(updated_at);",
        },
        Migration {
            version: 7,
            description: "blocked_artists",
            kind: MigrationKind::Up,
            // ⭐ "Bu sanatçıyı bir daha önerme" (v1.7.0).
            //
            // Eskiden olumsuz sinyal yalnız DOLAYLIYDI (geçersen yakınlık
            // düşer). Açık bir "istemiyorum" yoktu; sevmediğin bir sanatçı
            // yeterince güçlü sinyale sahipse dönüp duruyordu.
            //
            // ⚠️ ANAHTAR = SANATÇI ADI (küçük harf), uid DEĞİL. Ad cihazdan
            // bağımsız olduğu için iki cihaz aynı sanatçıyı engellese bile
            // TEK satırda birleşir — olay günlüklerindeki uid derdi burada yok.
            sql: "CREATE TABLE IF NOT EXISTS blocked_artists (
                    artist     TEXT PRIMARY KEY,   -- küçük harf
                    created_at INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0,
                    deleted    INTEGER NOT NULL DEFAULT 0,
                    device_id  TEXT
                  );
                  CREATE INDEX IF NOT EXISTS idx_blocked_upd ON blocked_artists(updated_at);",
        },
        Migration {
            version: 8,
            description: "taste_controls_graph_loudness",
            kind: MigrationKind::Up,
            // v1.8.0 — üç ayrı ihtiyaç, üç tablo:
            //
            // 1) `artist_prefs` — kullanıcının ELLE ayarı ("daha çok / daha az").
            //    SENKRONLANIR: bu bir KARAR, türetilmiş veri değil; anahtar
            //    sanatçı adı olduğu için iki cihazda tek satırda birleşir
            //    (blocked_artists ile aynı gerekçe).
            //
            // 2) `artist_edges` — sanatçı komşuluk grafiği ("X radyosunda Y
            //    çıktı"). ⛔ SENKRONLANMAZ, BİLEREK: bu bir SAYAÇ. Senkron LWW
            //    (last-write-wins) çalışır; iki cihazın saydığı birbirini EZER
            //    ve toplam kaybolur (aynı gerekçeyle taste.ts de kendi tablosunu
            //    tutmuyor). Üstelik veri bedava: her radyo çağrısında yeniden
            //    üretiliyor, cihaz kendi grafiğini birkaç günde kurar.
            //    `sample_id`: o sanatçıdan görülmüş bir video kimliği →
            //    kullanıcının hiç dinlemediği sanatçı bile RADYO TOHUMU olabilir
            //    (tohum video id ister; tracks'te olmayan sanatçı aksi hâlde
            //    asla tohum olamazdı).
            //
            // 3) `track_loudness` — ölçülen ses yüksekliği (LUFS + tepe).
            //    Senkronlanmaz: dosyadan türetilir, her cihaz kendi indirdiğini
            //    saniyeler içinde ölçer; buluta taşımaya değmez.
            sql: r#"CREATE TABLE IF NOT EXISTS artist_prefs (
                    artist     TEXT PRIMARY KEY,   -- küçük harf
                    weight     REAL NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0,
                    deleted    INTEGER NOT NULL DEFAULT 0,
                    device_id  TEXT
                  );
                  CREATE INDEX IF NOT EXISTS idx_prefs_upd ON artist_prefs(updated_at);

                  CREATE TABLE IF NOT EXISTS artist_edges (
                    seed       TEXT NOT NULL,      -- küçük harf
                    neighbor   TEXT NOT NULL,      -- küçük harf
                    weight     REAL NOT NULL DEFAULT 0,
                    sample_id  TEXT,               -- komşudan bir video kimliği
                    updated_at INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (seed, neighbor)
                  );
                  CREATE INDEX IF NOT EXISTS idx_edges_seed ON artist_edges(seed);
                  CREATE INDEX IF NOT EXISTS idx_edges_nb   ON artist_edges(neighbor);

                  -- ⭐ SANATÇI ETİKETLERİ: veritabanında TÜR ALANI YOK. Küratörlü
                  -- tür/ruh hali havuzu (music_genre_pool) çekildiğinde, o havuzda
                  -- görülen sanatçılara filtre kimliği etiket olarak yazılır.
                  -- Böylece "şu anki modun" satırı sanatçı adı yerine ANLAŞILIR
                  -- kelime gösterebilir ("sakin · rock"). Yerel: türetilmiş sayaç.
                  CREATE TABLE IF NOT EXISTS artist_tags (
                    artist     TEXT NOT NULL,      -- küçük harf
                    tag        TEXT NOT NULL,      -- lib/filters.ts kimliği
                    weight     REAL NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (artist, tag)
                  );
                  CREATE INDEX IF NOT EXISTS idx_tags_artist ON artist_tags(artist);

                  -- ⭐ SEÇMELİ AYAR SENKRONU (v1.8.0): `settings` bugüne kadar
                  -- HİÇ senkronlanmıyordu, çünkü içinde cihaza özel şeyler var
                  -- (resumeState, avatar, ses seviyesi). Ama kullanıcı tema/dil/
                  -- öneri ayarlarının cihazlar arası aynı olmasını istiyor.
                  -- Çözüm: tabloya senkron alanları eklenir, BEYAZ LİSTEDEKİ
                  -- anahtarlar taşınır (bkz. SYNCED_SETTING_KEYS, engine.ts).
                  ALTER TABLE settings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
                  ALTER TABLE settings ADD COLUMN deleted    INTEGER NOT NULL DEFAULT 0;
                  ALTER TABLE settings ADD COLUMN device_id  TEXT;

                  -- ⭐ CİHAZLAR ARASI KUYRUK (v1.8.0). now_playing yalnız TEK
                  -- parçayı taşıyordu; kullanıcı "Windows'taki Keşfet kuyruğu
                  -- Mac'e gelmedi, yeni keşif açtı" dedi. Kuyruğun kendisi
                  -- `settings.resumeState` içindeydi ve settings senkronlanmıyordu.
                  -- Cihaz başına satır → çakışma yok (now_playing ile aynı desen).
                  CREATE TABLE IF NOT EXISTS device_queue (
                    device_id    TEXT PRIMARY KEY,
                    device_name  TEXT,
                    mode         TEXT,     -- 'discovery' | 'normal'
                    playlist_id  TEXT,
                    queue_json   TEXT NOT NULL DEFAULT '',
                    queue_index  INTEGER NOT NULL DEFAULT 0,
                    position_ms  INTEGER NOT NULL DEFAULT 0,
                    filters_json TEXT,
                    seeds_json   TEXT,
                    updated_at   INTEGER NOT NULL DEFAULT 0,
                    deleted      INTEGER NOT NULL DEFAULT 0
                  );
                  CREATE INDEX IF NOT EXISTS idx_dq_upd ON device_queue(updated_at);

                  CREATE TABLE IF NOT EXISTS track_loudness (
                    track_id    TEXT PRIMARY KEY,
                    lufs        REAL NOT NULL,
                    peak_db     REAL NOT NULL,
                    measured_at INTEGER NOT NULL DEFAULT 0
                  );"#,
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
            commands::set_audio_quality,
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
            commands::measure_loudness,
            commands::prewarm_urls,
            commands::diagnose_download,
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

                // ⭐ OTOMATİK GÜNCELLEME (v1.8.1). Eskiden yt-dlp YALNIZ ilk
                // açılışta indiriliyordu ve bir daha hiç güncellenmiyordu.
                // YouTube çıkarım mantığını ayda birkaç kez değiştiriyor;
                // eskiyen yt-dlp'de indirme sessizce çöküyor ("not a bot",
                // "format not available"). Kullanıcının Windows'ta yaşadığı
                // "hiçbir şarkı açılmıyor" tablosunun en olası sebeplerinden
                // biri buydu — sistemde yt-dlp olmadığı için orada TEK kaynak
                // bu dosya.
                //
                // Dosyanın YAŞINA bakılır (settings'e erişim Rust tarafında
                // yok; dosya mtime'ı zaten doğru ve taşınabilir bir damga).
                const MAX_AGE_DAYS: u64 = 7;
                let needs_update = match std::fs::metadata(&exe) {
                    Err(_) => true, // hiç yok → ilk indirme
                    Ok(m) => m
                        .modified()
                        .ok()
                        .and_then(|t| t.elapsed().ok())
                        .map(|age| age.as_secs() > MAX_AGE_DAYS * 24 * 3600)
                        .unwrap_or(false),
                };
                if needs_update {
                    let first = !exe.exists();
                    let h = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        match commands::update_ytdlp(h).await {
                            Ok(v) => log::info!(
                                "yt-dlp {}: {v}",
                                if first { "ilk indirme tamam" } else { "otomatik güncellendi" }
                            ),
                            Err(e) => log::error!("yt-dlp güncellenemedi: {e}"),
                        }
                    });
                }
            }

            // İndirirken çalma yolundan kalan geçici dosyaları temizle.
            commands::cleanup_stream_files(&app.handle().clone());

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
