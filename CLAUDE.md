# Resonance — Proje Kılavuzu (yeni oturum için handoff)

Hafif, **karma tabanlı kişisel müzik oynatıcı**. Mac & Windows masaüstü (sonra Android).
Ses YouTube'dan gelir; Spotify/YouTube Music listeleri içe aktarılır. Tamamen
yerel/gizli (sunucu yok). Kullanıcı: Eren. **İletişim dili: Türkçe.**

> Bu dosya projeyi hızla kavraman için. Ayrıntılı geçmiş + kararlar otomatik
> belleğinde (`memory/resonance-project.md`). Senkron planı `docs/SYNC.md`,
> sürüm rehberi `docs/RELEASE.md`.

## ⛔ Kritik kurallar
- **ASLA `git commit` / `git push` yapma** — kullanıcı bunları elle yapıyor. Sadece dosyaları düzenle.
- Türkçe konuş; kod/yorumlar da Türkçe (mevcut stile uy).
- Gerçekçi ol: kullanıcı abartı değil dürüst değerlendirme istiyor.
- yt-dlp ile YouTube sesi çekmek YouTube ToS'una aykırı olabilir → kişisel kullanım, repo **private**.

## Teknoloji
- **Kabuk:** Tauri 2 (Rust). Electron DEĞİL (hafiflik şartı).
- **Arayüz:** React 18 + TypeScript + Vite + **Tailwind v4** (`@theme` token'ları `src/index.css`).
- **Durum:** zustand (`src/store/*`). **DB:** SQLite (`tauri-plugin-sql`), migration'lar `src-tauri/src/lib.rs`.
- **Ses:** Rust `rodio` (kendi thread'i, `src-tauri/src/audio.rs`). `reqwest` (Spotify API).
- **Dış araçlar:** `yt-dlp` (arama/indirme), `ffmpeg` (remux). Hem sistemde hem **sidecar gömülü**.

## Build / çalıştırma / test (ÖNEMLİ — bu akışı kullan)
`tauri dev` sandbox'ta GUI açamayıp çıkıyor. Bunun yerine **.app paketleyip `open` ile** çalıştır:
```bash
# frontend tip kontrolü:
npm run build
# native debug paketi (sidecar'larla; ilk build sonrası hızlı):
npm run tauri build -- --debug --bundles app
# kullanıcının oturumunda başlat + logları yakala:
open "src-tauri/target/debug/bundle/macos/Resonance.app" --stdout /tmp/res_out.log --stderr /tmp/res_err.log
```
Doğrulama: computer-use ile ekran görüntüsü (Ekran Kaydı izni AÇIK olmalı) + `/tmp/res_err.log` panik kontrolü
+ DB sorgusu: `sqlite3 ~/Library/"Application Support"/com.resonance.app/resonance.db "..."`.
Önizleme (preview) MCP yalnızca düz web UI'yi gösterir; Tauri özellikleri (yt-dlp, DB) orada çalışmaz.

## Mimari özet
- **Görünümler** (`src/views/`): Home(Şu An), Search, Library(Kütüphane), Downloads, Playlist, Import, Settings.
- **Oynatıcı** (`src/store/usePlayerStore.ts`): kuyruk, playNow, **startRadio** (karma-ağırlıklı + öneri serpiştirme),
  prefetch (3 önden), uyku zamanlayıcı, playback-error→toast+otomatik atlama. Ses motoruna Tauri komutlarıyla bağlı;
  pozisyon `playback-tick` olayıyla gelir.
- **Rust komutları** (`src-tauri/src/commands.rs`): search_youtube, import_playlist, import_spotify, get_lyrics,
  play_track, download_audio, prefetch_audio, delete_audio, cache_files, delete_cache_except, export_data,
  backup_db / list_backups / restore_backup, audio_play/pause/seek/stop/set_volume/status.
- **Ses motoru** (`audio.rs`): rodio Sink, AudioCmd kanalı, `catch_unwind` ile çözümleme paniğine dayanıklı.
- **yt-dlp/ffmpeg** (`ytdlp.rs`): `resolve_bin()` ÖNCE sistemdekini (hızlı), yoksa gömülü sidecar'ı kullanır.
- **Öneri** (`src/lib/recommender.ts`): oyların saat/gün bağlamından sanatçı yakınlığı; YouTube + kütüphane kaynağı.
- **DB tabloları:** tracks, playlists, playlist_tracks(+vote), votes(olay günlüğü), play_history, cache(+downloaded), settings.

## Kritik kararlar & GOTCHA'lar (bunları bil)
1. **Ses biçimi = ADTS .aac**: bestaudio (m4a) indirilir, `ffmpeg -c:a copy -f adts` ile YENİDEN KODLAMADAN
   remux edilir. rodio m4a/MP4'ü çözerken panikler (gapless seek); ADTS'de panik yok. Eski cache .mp3 de çalar.
2. **`resolve_bin` sistemi tercih eder**: gömülü PyInstaller yt-dlp her çağrıda ~12sn (!), sistemdeki ~1.7sn.
   Önce /opt/homebrew/bin vb., yoksa sidecar.
3. **tracks'e ASLA `INSERT OR REPLACE` YAPMA** → satırı silip ekler, `ON DELETE CASCADE` şarkıyı TÜM listelerden
   uçurur. `ensureTrack` (lib/playlists.ts) `ON CONFLICT(id) DO UPDATE` kullanır; her yerde bunu çağır.
4. **YouTube kimliksiz playlist'i ~100 öğeyle sınırlar** → tam liste için `--cookies-from-browser` (Ayarlar →
   Entegrasyonlar > tarayıcı). Çerez HARVESTING (birçok tarayıcıyı tarama) güvenlik sınıflandırıcısıyla engellenir.
5. **Spotify sesi alınamaz** → sadece metadata (Client Credentials, ücretsiz client_id/secret Ayarlar'da) → YouTube'da eşleştir.
6. **Veri güvenliği:** açılışta veri varsa otomatik DB yedeği (son 12, `backups/`), tek-örnek koruması TÜM build'lerde
   (`#[cfg(desktop)]`). Geçmişte iki-instance yarışından şüphelenilen bir veri kaybı yaşandı; bu yüzden bu önlemler var.

## Durum: M0–M8 ✅ (hepsi bitti, Mac'te canlı doğrulandı)
Çalma, arama (canlı/debounce), playlist CRUD + paylaşım kodu, karma (biriken oy + saatlik cooldown + decay),
Resonance Radyosu + öneriler, içe aktarma (YT/YT Music + Spotify), detaylı ayarlar, sözler/uyku zamanlayıcı,
toplu indirme, .dmg + .exe CI (`.github/workflows/release.yml`), yedek/restore. **Spotify import kodu hazır ama
kullanıcı kendi anahtarıyla canlı test edecek.**

## 🐛 AÇIK SORUNLAR (öncelik — Windows)
Kullanıcı uygulamayı Windows'a kurdu, aramada şunlar oldu:

1. **Arka arkaya konsol pencereleri açılıyor.**
   - Sebep: `std::process::Command` Windows'ta her alt süreç için konsol penceresi açar; yt-dlp/ffmpeg (arama,
     çalma, prefetch) çok kez çağrıldığı için 2-3 pencere fırlıyor. Kodda hiç `creation_flags` yok.
   - Çözüm: `ytdlp.rs`'deki `yt_dlp()` ve `ffmpeg()` Command kurucularına Windows'ta `CREATE_NO_WINDOW` ekle:
     ```rust
     #[cfg(windows)]
     use std::os::windows::process::CommandExt;
     // her iki kurucuda:
     #[cfg(windows)]
     c.creation_flags(0x08000000); // CREATE_NO_WINDOW
     ```

2. **Arama çubuğu altında hata:** `yt-dlp arama başarısız: ERROR: could not find opera cookies database in
   "C:\Users\erens\AppData\Roaming\Opera Software\Opera Stable"`
   - Sebep: cookiesBrowser ayarı "opera" (ya da "opera-gx") seçili; yt-dlp `--cookies-from-browser opera`
     ile **Opera Stable**'ı arıyor ama kullanıcıda **Opera GX** var → bulamayıp TÜM aramayı hata veriyor.
     Ayrıca `ytdlp.rs`'deki opera-gx yolu Mac'e özel (`$HOME/Library/...`), Windows'ta kırık.
   - Çözüm (iki parça):
     a) **opera-gx'i platforma göre çöz** (Windows: `%APPDATA%\Opera Software\Opera GX Stable`,
        Mac: `~/Library/Application Support/com.operasoftware.OperaGX`, Linux: `~/.config/opera-gx`).
     b) **Çerez hatasını ölümcül yapma**: yt-dlp çıktısı "could not find ... cookies" içeriyorsa çerezsiz
        TEKRAR dene (search/playlist_meta/ensure_audio). Böylece yanlış tarayıcı seçimi aramayı kırmaz.
        En sağlamı bu — kullanıcı yine arama yapabilir, sadece tam-playlist/özel-liste avantajı olmaz.

## Sırada / ertelenenler (opsiyonel)
- Gerçek **streaming** (ffmpeg PCM pipe → rodio): kullanıcı şimdilik istemedi; sistem-yt-dlp fix'i yavaşlığı çözdü.
- M7 kalan: global kısayollar, mini/menubar player, **equalizer** (rodio'da DSP gerektirir — en zoru).
- **Mobil + web + hesap senkronu**: `docs/SYNC.md` (Supabase planı; web'de yt-dlp çalışmadığı için YouTube IFrame Player).
