# Resonance — Proje Kılavuzu (yeni oturum için handoff)

Hafif, **karma tabanlı kişisel müzik oynatıcı**. Mac & Windows masaüstü (mobil planlandı:
`docs/MOBILE.md`). Ses YouTube'dan gelir; Spotify/YouTube Music listeleri içe aktarılır.
Tamamen yerel/gizli (sunucu yok). Kullanıcı: Eren. **İletişim dili: Türkçe.**

**Durum: v1.2.3** — masaüstü olgun ve günlük kullanımda. Mac'te sorunsuz; Windows'ta bilinen
tüm indirme/çalma sorunları çözüldü. Açık kritik bug yok.
v1.2.0'da: öğrenme sinyalleri genişledi (playlist üyeliği), TR/EN dil, açık tema, ilk açılış rehberi.
v1.2.1'de: **OS medya oturumu** (souvlaki) — macOS F7/F9 ve Windows'ta oyun açıkken
medya tuşları artık çalışıyor; kilit ekranında şarkı bilgisi. Ayrıca çerçevesiz pencere,
UI'da gerçek logo (◈ değil), Windows'a ÖZEL tam-taşan ikon.
v1.2.2'de: Windows CI build fix (`raw-window-handle` dep), **Keşfet kuyruğu kalıcı** (kapat-aç
hatırlar, reroll'a kadar sabit), öneri gerekçesi YAPISAL (dil değişince çevrilir), playlist
ekleme/oluşturma toast'ları, çeşitli i18n düzeltmeleri.
v1.2.3'te: **macOS ad-hoc imza** (`signingIdentity:"-"` → "damaged" hatası biter, sağ tık→Aç),
**indirme taze-çıkarım retry** (geçici HTTP 403 throttle'a karşı 3 deneme → çok daha az
"indirilemedi"), Keşfet'te karışık tuşu KİLİTLİ (modu bozup reset atmıyor), indirme-hatası
toast'ı + iki i18n düzeltmesi.

> Ayrıntılı geçmiş + kararlar otomatik bellekte (`memory/resonance-project.md`).
> Mobil planı `docs/MOBILE.md`, senkron protokolü `docs/SYNC.md`, sürüm rehberi `docs/RELEASE.md`.

## ⛔ Kritik kurallar
- **ASLA `git commit` / `git push` / `git tag` yapma** — kullanıcı bunları elle yapıyor. Sadece dosyaları düzenle.
- Türkçe konuş; kod/yorumlar da Türkçe (mevcut stile uy).
- Gerçekçi ol: kullanıcı abartı değil dürüst değerlendirme istiyor. Çalışmayan şeye "çalışıyor" deme,
  test etmediğin şeye "test ettim" deme.
- yt-dlp ile YouTube sesi çekmek YouTube ToS'una aykırı olabilir → kişisel kullanım, repo **private**.

## Teknoloji
- **Kabuk:** Tauri 2 (Rust). Electron DEĞİL (hafiflik şartı).
- **Arayüz:** React 18 + TypeScript + Vite + **Tailwind v4** (`@theme` token'ları `src/index.css`).
- **Durum:** zustand (`src/store/*`). **DB:** SQLite (`tauri-plugin-sql`), migration'lar `src-tauri/src/lib.rs`.
- **Ses:** Rust `rodio` + symphonia (kendi thread'i, `src-tauri/src/audio.rs`). `reqwest` (Spotify).
- **Dış araçlar:** `yt-dlp` (arama/indirme), `ffmpeg` (remux). Sistemde varsa o, yoksa gömülü sidecar.
- **Eklentiler:** sql, log, single-instance, autostart, global-shortcut. `tokio` (sync/Semaphore).

## Build / çalıştırma / test (ÖNEMLİ — bu akışı kullan)
`tauri dev` sandbox'ta GUI açamayıp çıkıyor. Bunun yerine **.app paketleyip `open` ile** çalıştır:
```bash
npm run build                                  # frontend tip kontrolü (tsc + vite)
cd src-tauri && cargo check                    # Rust tip kontrolü
npm run tauri build -- --debug --bundles app   # native debug paketi (sidecar'larla)
open "src-tauri/target/debug/bundle/macos/Resonance.app" --stdout /tmp/res_out.log --stderr /tmp/res_err.log
```
Doğrulama: computer-use ekran görüntüsü (`request_access` uygulama adı **`com.resonance.app`** —
"Resonance" ile istersen zaman aşımına düşüyor), `/tmp/res_err.log` panik kontrolü, DB sorgusu:
`sqlite3 ~/Library/"Application Support"/com.resonance.app/resonance.db "..."`.
Uygulama logu: macOS `~/Library/Logs/com.resonance.app/`, Windows `%APPDATA%\com.resonance.app\logs\`.
**Preview (web) MCP'si işe yaramaz** — Tauri özellikleri (yt-dlp, DB, invoke) orada çalışmaz.
**⭐ WINDOWS-ONLY Rust kodunu macOS'tan DOĞRULA** (`#[cfg(windows)]` blokları `cargo check`'te
atlanır → hata Windows CI'da patlar; v1.2.1'de `raw_window_handle` eksikliği böyle kaçtı):
`brew install mingw-w64 && rustup target add x86_64-pc-windows-gnu`, sidecar için
`touch src-tauri/binaries/{yt-dlp,ffmpeg}-x86_64-pc-windows-gnu.exe` (sahte, .gitignore'da),
sonra `cd src-tauri && cargo check --target x86_64-pc-windows-gnu`. Bitince sahte dosyaları sil.

## Mimari özet
- **Görünümler** (`src/views/`): Home (Şu An), Search, Library, Downloads, Playlist, Import, Settings.
- **Sidebar**: Şu An · **Keşfet** (aksiyon: `startDiscovery`) · Ara · Kütüphane · İndirilenler · İçe Aktar · Ayarlar.
- **Oynatıcı** (`src/store/usePlayerStore.ts` — en büyük dosya): kuyruk, `playNow`, `startSmartShuffle`,
  `startDiscovery`, `refillRadio`, `restoreState`, uyku zamanlayıcı, medya tuşları, prefetch.
  Ses motoruna Tauri komutlarıyla bağlı; pozisyon `playback-tick` olayıyla gelir.
- **Rust komutları** (`src-tauri/src/commands.rs`): search_youtube, **music_radio** (öneri kaynağı),
  import_playlist, import_spotify,
  get_lyrics, play_track, download_audio, prefetch_audio, delete_audio, is_cached, cache_files,
  delete_cache_except, export_data, backup_db / list_backups / restore_backup, update_ytdlp, read_log,
  audio_play/pause/seek/stop/set_volume/status.
- **Ses motoru** (`audio.rs`): rodio Sink, AudioCmd kanalı, `catch_unwind` ile çözümleme paniğine dayanıklı.
  `Load{start_ms}` ile kaldığın yerden devam.
- **yt-dlp/ffmpeg** (`ytdlp.rs`): `resolve_bin()` sırası → sistem → **app_data/bin (runtime güncellenen)** →
  sidecar → PATH.
- **Öneri** (`src/lib/recommender.ts`): tek skorlama modeli (aşağıda ayrı bölüm).
- **DB tabloları:** tracks, playlists, playlist_tracks(+vote), votes (olay günlüğü), play_history,
  cache(+downloaded), settings, **recommendation_history**. Migration'lar: v1 ilk şema, v2 downloaded,
  v3 current_vote, v4 recommendation_history.

## Öneri motoru (`src/lib/recommender.ts`) — nasıl çalışır
Tüm sinyaller tek skorda birleşir:
- **⭐ İKİ AYRI HARİTA — bu ayrım kritik, bozma:**
  - `artistAffinity` = "KİMİ seviyorum" → hangi radyoları açacağımızı seçer → o tarzda YENİ şarkılar.
    Kaynaklar: oylar + dinleme + **playlist üyeliği**.
  - `trackKarma` = "HANGİ PARÇAYI seviyorum" → yalnız **favori dönüşünde** kullanılır.
    **Playlist üyeliği burayı BESLEMEZ** — beslerse listendeki her şarkı "favori" sayılıp Keşfet
    kuyruğunu kendi şarkıların doldurur (kullanıcı bunu açıkça istemedi).
- **Oylar** (`votes`): değer × zaman-decay × bağlam (saat/gün benzerliği) → her iki haritayı besler.
- **⭐ PLAYLIST ÜYELİĞİ** (`playlist_tracks`, v1.2.0): "listeme ekledim" = beğeni beyanı.
  Ağırlık 0.6 (oydan düşük), yarı ömür **4× uzun** (liste tercihi kalıcıdır), **bağlam çarpanı YOK**
  (kimi sevdiğini söyler, ne zaman'ı değil). YALNIZ `artistAffinity`'yi besler.
  **Neden kritik:** bu sinyal olmadan algoritma zevkin yalnız oy verdiğin kısmını görüyordu —
  ölçüm: **8 sanatçı**. Playlist'lerde **183** sanatçı var → havuz **23 katına** çıktı.
  "Hep aynı tarzı öneriyor" şikâyetinin KÖK sebebi buydu.
- **Dinleme davranışı** (`play_history`): <5sn −0.35, oran <%15 −0.25, >%40 +0.15, >%70 +0.4
  (aynı decay/bağlam çarpanıyla). Yani sadece upvote'lananlar değil, gerçekten dinlenenler de sayılır.
- **Kaynaklar:** (a) kütüphane — yalnızca **BAŞKA** bir playlist'te olan parçalar (o an çalan listeden
  öneri yok), sanatçı başına en fazla 2; (b) YouTube — **YouTube Music radyosu** (aşağıda).
- **⭐ YouTube kaynağı = RADYO, metin araması DEĞİL** (`ytdlp::music_radio` → `music_radio` komutu).
  `https://music.youtube.com/watch?v=<id>&list=RDAMVM<id>` → YouTube Music'in kendi öneri motoru.
  **Neden:** eskiden `ytsearch:songs like {sanatçı}` yapılıyordu; YouTube o sorguya VİDEO döndürüyor,
  şarkı değil → kuyruk röportaj, tepki videosu, "5 Things You Didn't Know…", belgesel kesiti, kısa film
  ile doluyordu. **Bu başlık sezgisiyle çözülemez** ("Meet Dark R&B's Newest Darling" bir röportajdır;
  hiçbir anahtar kelime yanlış-eleme yapmadan yakalayamaz). Radyo yapısı gereği yalnız şarkı döner.
  - **Seed = VİDEO ID** (sanatçı adı değil) → seed'ler en güçlü sinyalli **parçalar**
    (`trackKarma + artistAffinity`).
  - **⚠️ SANATÇI BAŞINA EN İYİ TEK PARÇA** → **ağırlıklı rastgele** 12 SANATÇI → **3 radyo paralel**.
    Eskiden "en iyi 12 PARÇA" alınıyordu: son oylar tek sanatçıda toplanınca 12'nin çoğu o sanatçı
    oluyordu (ölçüm: 200 denemenin **200'ünde** aynı sanatçıdan >1 seed) → tüm radyolar aynı tarz →
    "hep rap öneriyor" bug'ı. Sanatçı başına tek parça ile bu oran **%0**.
  - **⚠️ ROUND-ROBIN**: her radyodan SIRAYLA birer parça alınır. Eskiden radyolar sırayla tüketiliyordu →
    ilk radyo 20 kontenjanın hepsini doldurup diğerlerine hiç sıra gelmiyordu (yine tek tarz).
  - **Reroll** (`rerollDiscovery`, Sıra panelinde "Başka tarz"): `excludeSeedArtists` ile mevcut partinin
    seed sanatçıları dışlanır → gelen tarz gerçekten değişir. `Recommendation.seedArtist` bunu taşır;
    store `discoverySeedArtists`'te tutar, panel başlığında "… tarzı" diye gösterir.
  - **⭐ AĞIRLIKLI RASTGELE ÖRNEKLEME** (v1.2.0, katı "en iyi 12" DEĞİL): playlist sinyali havuzu
    8 → 184 sanatçıya çıkardı, ama KATI sıralamada oy verilen 8 sanatçı yine ilk 12'yi kapıyordu →
    havuz büyüse de aynı tarz geliyordu. Gumbel hilesi (`key = -ln(rastgele)/ağırlık`, küçükten sırala)
    ile her sanatçının seçilme ŞANSI yakınlığıyla orantılı: çok sevdiklerin sık, listendekiler seyrek
    ama DÜZENLİ gelir (keşif/sömürü dengesi).
    Ölçüm: 300 denemede seçilen farklı sanatçı **10 → 165**, en baskın sanatçının payı **%37 → %15**.
  - **Sınır:** seed çeşitliliği sinyalli sanatçı sayısıyla sınırlı — ama artık playlist üyeliği de
    saydığı için havuz geniş (kullanıcıda 184 sanatçı).
  - Ölçüm: seed başına **~2.9sn / 50 sonuç / 15-46 farklı sanatçı / süresi eksik 0**.
    (Limitsiz çekilirse 1000+ sonuç ama ~20sn → `--playlist-end 50` şart.)
  - Radyo sonuçları **karıştırılır** (hep ilk parçalar gelmesin) + **sanatçı başına 2 sınırı**:
    radyonun başı seed sanatçının kendi şarkılarıyla dolu (Tarkan radyosunda ilk 3 parça Tarkan).
  - `isLikelySong` yine uygulanır — radyoda da 1000'de ~5 uzun içerik çıkıyor.
  - **Metin araması yalnız soğuk-başlangıç YEDEĞİ** (`addSearchFallback`): hiç oy/dinleme yoksa veya
    radyo boş dönerse. Birkaç sinyal sonrası bir daha çalışmaz.
- **Filtreler:** `isLikelySong` (süre + başlık/kanal deseni — aşağıda ayrı not), `normKey` (başlık+sanatçı),
  **`songCore`** (sanatçıdan BAĞIMSIZ şarkı-adı çekirdeği → aynı şarkının cover / sped-up / slowed+reverb /
  "official video" versiyonlarını eler), kalıcı geçmiş (son 45 gün, `recommendation_history`).
- **⭐ FAVORİ DÖNÜŞÜ** (v1.2.0, `FAVORITE_SHARE=0.15`): "geçen hafta bu saatte sevdiğim şarkı yine
  gelsin". İKİ SIKI ŞART: (1) `trackKarma > 0` — parçaya AÇIKÇA oy verilmiş ya da >%70 dinlenmiş
  olmalı (sadece listede olmak YETMEZ); (2) `contextMatch >= 0.35` — parça ŞU ANKİ gün/saat moduna
  ait olmalı. Kuyruğun en fazla **%15'i** (20'de 3) → Keşfet keşif olarak kalır.
  **Favoriler 45-gün `recommendation_history` engelinden MUAFTIR** (`recentlyRecommended` ayrı küme
  tutulur, `taken`'a karıştırılmaz) — yoksa sevdiğin şarkı 45 gün geri gelemezdi.
  Kullanıcının kararı: "sevdiklerim dönsün, keşifler dönmesin".
- **⭐ CONTEXT_FLOOR = 0.25** (v1.2.0): `contextWeight` eskiden saf çarpımdı; 12 saat uzaktaki oy
  `exp(-12/3)=0.018` ile SIFIRLANIYORDU → gece 3'te uygulamayı açınca havuz boşalıyordu.
  Artık: taban (%25 genel zevkin) + %75 bağlam uyumu. `contextMatch` ise TABANSIZ (0..1) —
  favori dönüşünde kullanılır, orada taban istemeyiz.
- **Kapsam kritiği:** `excludeIds` (ID) TEK BAŞINA YETMEZ — aynı şarkının farklı kaydının ID'si farklıdır.
  Bu yüzden `excludeCores` (songCore kümesi) de her çağrıya geçirilir; store'da oturum boyu tutulur
  (`recommendedCoresThisSession`).
- **⭐ ÖNERİ GEREKÇESİ YAPISAL** (v1.2.2, `RecReason` = {key, seed?, artist?, dow?}, STRING DEĞİL):
  eskiden reason üretim anındaki dile göre string olarak sabitleniyordu → dil sonradan değişince
  (veya prewarm settings yüklenmeden çalışınca) yanlış dilde kalıyordu ("cumartesi bu saatlerde"
  EN arayüzde). Artık `reasonText(reason, lang)` GÖSTERİRKEN çevirir; `dow` sayı saklanır, gün adı
  render anında `dayNameOf` ile üretilir. Kalıcı Keşfet kuyruğunda da doğru dilde gelir.
- `getRecommendations` kalıcı geçmişe **yazar**; `record: false` ile yazmadan hesaplanır (prewarm bunu
  kullanır, öneri gerçekten kullanılınca `recordRecommended` çağrılır → prewarm önerileri boşa harcanmaz).
- **Bilinçli tercih:** `songCore` aynı isimli GERÇEKTEN farklı şarkıları da eleyebilir. Kullanıcı bunu
  kabul etti (tekrar görmek, kaçırmaktan kötü).

### `isLikelySong` — müzik-dışı içerik filtresi (podcast vb.)
- **Süre: 40sn – 9dk.** Tavan ampirik: kullanıcının 225 parçalık kütüphanesinde 8dk'yı geçen TEK parça var
  (Master of Puppets 8:35). Eski 12dk tavanı gevşekti → 10dk'lık podcast öneri olarak geldi.
  Süre 0 (bilinmiyor) ise eleme yapma, desenlere bırak.
- **Desenler KELİME SINIRLI (`\b`) olmalı — düz `includes` KULLANMA.** Eski hali düz substring'di ve
  gerçek şarkıları sessizce eliyordu: `"hour"` → *Hourglass* / *24 Hours*, `"mix"` → her **Remix** ve
  *Mixed Emotions*, `"best of"` → *The Best of Me*. `\bmix\b` bunlara takılmaz ama "Summer Mix"i yakalar.
- **İş bölümü:** uzun içerik (mix, full album, uzun podcast) zaten **süre tavanıyla** elenir. Desenler
  ikinci savunma hattı: süresi bilinmeyen sonuçlar + **süresi şarkı aralığına düşen** konuşma içeriği
  (kısa podcast bölümü, röportaj, tepki videosu). Asıl hedef bu ikincisi.
- **Yeni desen eklerken yanlış-eleme tuzağı** — şu kelimeler ŞARKI adlarında geçer, tek başına kullanma:
  `talk` (Khalid), `news` (Good News), `story` (Love Story), `reaction` (Chain Reaction),
  `how to` (How To Save A Life), `ama` (TR: "…Ama"), `nasıl` (Nasıl Geçti Habersiz), `hours` (Tycho).
  Bunun yerine bağlamlı desen: `\breacts? to\b`, `\bnasıl\b.{0,24}\b(yapılır|yazılır)\b`,
  `\b\d+\s*hours?\s+(of|loop)\b`.
- **Kanal sinyali** (`t.artist` = YouTube'da kanal adı) bilerek dar: yalnız `\bpodcasts?\b`.
  `talk`/`tv`/`fm` eklenmemeli — *Kral TV*, *MTV*, "FM Records" gibi müzik kanallarını eler.
- **YT Music ARAMASI denendi, OLMUYOR** (radyo ile karıştırma!): `music.youtube.com/search?q=…` yalnız
  müzik döndürür ama flat-playlist çıktısında **süre ve sanatçı yok**, bazı satırlarda başlık bile boş →
  `songCore`/süre filtresi/`spreadByArtist` çalışamaz. **RADYO** (`…/watch?v=X&list=RDAMVMX`) ise tüm
  alanları dolu verir — asıl YouTube kaynağı bu (yukarıya bak).

## Kritik kararlar & GOTCHA'lar (bunları bil)
1. **Ses biçimi = ADTS `.aac`**: bestaudio (m4a) indirilir, `ffmpeg -vn -c:a copy -f adts` ile YENİDEN
   KODLAMADAN remux edilir. rodio m4a/MP4 çözerken panikler; ADTS'de panik yok. Eski cache `.mp3` de çalar.
2. **Format seçici**: `bestaudio[ext=m4a]/bestaudio/best[height<=480]/best`. Sondaki `/best` ŞART —
   bazı durumlarda audio-only DASH görünmez ("Requested format is not available"); muxed inip `-vn` ile ses alınır.
3. **`player_client=android` ZORLAMA** — android yalnızca muxed format 18'i (96k, kalitesiz) verir.
   Default client çerezsiz audio-only 140'ı (128k AAC) verir. ("Ses kalitesiz" bug'ının sebebi buydu.)
4. **ÇEREZ = tehlike**: `--cookies-from-browser` (a) her aramada tarayıcı çerez DB'sini okuyup çok yavaşlatır,
   (b) giriş yapılmış çerez YouTube'u "bot" moduna sokup **yalnızca storyboard** döndürebilir (Windows'taki
   "indirilemedi" saga'sının GERÇEK sebebi buydu). → **Arama HEP çerezsiz**; **indirme önce çerezsiz**,
   olmazsa çerezle bir kez daha dener.
5. **`-N` (paralel parça) KULLANMA** → HTTP 403/416 throttle. Tek bağlantı güvenilir.
6. **Aynı video için tek indirme kilidi** (`inflight_lock`, ytdlp.rs): play + prefetch + refill aynı dosyaya
   yazınca 416 / "no such file" / "invalid data" oluyordu.
7. **Eşzamanlılık sınırı** (`dl_semaphore`, commands.rs, izin=2): prefetch + toplu indirme sınırlı;
   **play_track sınırsız** (çalma her zaman öncelikli, kuyrukta beklemesin).
8. **`play_track` nesil guard'ı** (`PLAY_GEN`, AtomicU64): indirme biterken kullanıcı başka şarkıya geçtiyse
   eski `Load` gönderilmez → "playbar başka, çalan başka şarkı" yarışı olmaz.
9. **Frontend debounce**: `scheduleLoad` 180ms (tek yükleme), prefetch ayrı 1500ms timer → hızlı geçişte
   uygulama şişmez (her atlanan şarkıyı yüklemeye çalışmaz).
10. **`loadAndPlay` stale-token**: yükleme hatası yalnızca EN GÜNCEL istekte kuyruğu ilerletir. Yoksa arkada
    ölü bir öneri hata verince O AN çalan şarkı atlanıyordu ("durup dururken şarkı geçti" bug'ı).
11. **`is_permanent_error`**: "Video unavailable/private/removed" → çerez retry'ı ve `-F` yapma, hemen bırak.
    DİKKAT: "requested format is not available" **geçicidir**, buraya ASLA ekleme.
11b. **⭐ İNDİRME 403 = GEÇİCİ THROTTLE, RETRY GEREKİR** (v1.2.3, `ensure_audio`): asıl ses baytlarını
    indirirken YouTube çok sayıda eşzamanlı istek altında "unable to download video data: HTTP Error 403
    Forbidden" döndürüyor. **Format ÇÖZÜLÜR** (`--simulate` geçer, `-F` liste verir) ama bayt indirme
    reddedilir → tek denemede "indirilemedi". ÖLÇÜLDÜ: 403 veren videolar dakikalar sonra AYNI argümanla
    iniyor, çünkü **her yeni yt-dlp çağrısı TAZE format URL'si** üretir. Çözüm: geçici hatada artan
    beklemeyle (1.2sn/2.4sn) **3 kez taze-çıkarım retry** + yt-dlp'nin kendi `--retries/--fragment-retries`.
    **Bu bir client/format sorunu DEĞİL** — `player_client=ios/android` denendi, DAHA KÖTÜ ("Requested
    format is not available", ios m4a vermez; android 96k). `--simulate` ile test YANILTIR (403 orada
    görünmez); gerçek indirme + app logu (`~/Library/Logs/com.resonance.app/`) ile teşhis et.
    **Not:** `resolve_bin` sistemi (`/opt/homebrew/bin`) app_data/bin'den (runtime güncellenen) ÖNCE
    seçer → dev makinesinde eski Homebrew yt-dlp, taze auto-update'i gölgeliyor olabilir (`brew upgrade
    yt-dlp` veya sistemden kaldır). Son kullanıcıda sistemde yt-dlp yok → auto-update düzgün kullanılır.
12. **`tracks`'e ASLA `INSERT OR REPLACE` YAPMA** → satırı silip ekler, `ON DELETE CASCADE` şarkıyı TÜM
    listelerden uçurur. `ensureTrack` (`src/lib/playlists.ts`) `ON CONFLICT(id) DO UPDATE` kullanır; onu çağır.
13. **Oy verirken VE dinleme kaydederken ÖNCE `ensureTrack` çağır — yoksa SİNYAL SAYILMAZ.** `recommender.ts` oyları
    `votes v JOIN tracks t ON t.id = v.track_id` (INNER) ile okur. Keşfet/radyo önerisi hiçbir listede
    olmadığı için `tracks`'te de yoktu → JOIN oyu düşürüyordu, Keşfet'te oy vermek öğrenmeye HİÇ etki
    etmiyordu (ölçüldü: 15 oyun yalnız 11'i görülüyordu). `NowPlayingBar.handleVote` artık önce
    `ensureTrack` yapıyor. Bu bir listeye EKLEME değildir: İndirilenler `cache.downloaded=1` ister,
    Kütüphane playlist'leri gösterir → parça yalnız öğrenme sinyali olarak sayılır.
    **AYNI HATA `play_history`'de de vardı** (v1.2.0'da bulundu): `recordPlay` ensureTrack yapmıyordu →
    375 kaydın **104'ü YETİMDİ** ve bunlar EN UZUN dinlemelerdi (440sn'ye kadar) — yani Keşfet'te
    gerçekten sevip sonuna kadar dinlediğin şarkılar öğrenmeye HİÇ katılmıyor, algoritma yalnız
    atlananları görüp "hiçbir şeyi tamamlamıyor" sanıyordu. `lib/history.ts` artık ensureTrack yapıyor.
    (DB'deki eski 104 yetim kayıt kurtarılmadı — metadata'ları yok.)
14. **Spotify sesi alınamaz** → sadece metadata → YouTube'da eşleştirilir.
15. **`audio.rs` hata dalları**: hata verirken `ended_emitted = true` yap; yoksa hem `playback-error` hem
    `track-ended` gidip **çift atlama** olur.
16. **Windows `augmented_path()`**: PATH ayracı platforma göre (`;` vs `:`) — Unix yollarını `:` ile Windows
    PATH'ine eklemek PATH'i komple bozuyordu.
17. **⭐ MEDYA TUŞLARI = OS MEDYA OTURUMU, global hotkey DEĞİL** (`media_controls.rs`, souvlaki).
    Global hotkey iki yerde ÇUVALLIYOR ve bu tuş listesi genişleterek çözülmez:
    • **macOS**: F7/F9 normal tuş değil — `NX_KEYTYPE_NEXT/PREVIOUS` sistem olayı gönderirler,
      macOS bunları doğrudan "Now Playing" uygulamasına yollar; global hotkey hiç görmez.
      (F8 çalışıyordu çünkü `MediaPlayPause` global-shortcut ile eşleşiyor.)
    • **Windows**: tam ekran oyun RAW INPUT alınca global hotkey tetiklenmez (video oynatıcı
      raw input almadığı için orada çalışıyordu — kullanıcının gözlemi tam isabet).
    Çözüm: souvlaki → macOS MPRemoteCommandCenter, Windows SMTC. `media-control` olayı
    frontend'e düşer. Global hotkey YEDEK olarak duruyor (OS oturumu kurulamazsa).
    Yan fayda: kilit ekranı/Control Center'da şarkı adı+sanatçı (Spotify gibi).
18. **Windows'ta `CREATE_NO_WINDOW`** (`no_window()`, 0x08000000): yoksa her yt-dlp/ffmpeg çağrısında konsol
    penceresi fırlar.
19. **⭐ ÇERÇEVESİZ PENCERE — sürükleme İZİN ister** (v1.2.1). `titleBarStyle: "Overlay"` +
    `hiddenTitle: true` → macOS'ta başlık şeridi yok, trafik ışıkları içeriğin üstünde yüzer
    (Spotify görünümü). AMA pencere artık YALNIZ `data-tauri-drag-region`'dan taşınır ve bu
    **`core:window:allow-start-dragging` iznini** gerektirir — `core:default` bunu KAPSAMAZ.
    İzin yoksa pencere hiç hareket etmez (sessizce; hata da vermez). İzin
    `capabilities/default.json`'da. Sürükleme şeridi App.tsx'in en üstünde (h-7, sol 5rem
    boşluk trafik ışıkları için). Windows'ta `decorations:false` + özel min/max/kapat
    butonları gerekir — YAPILMADI, test edilemedi.
20. **⭐ İKON: macOS ve Windows AYRI kaynaklardan üretilir.**
    `app-icon.svg` → 1024 kanvasta 832×832 (macOS'un **%9.4 şeffaf kenar** standardı).
    Windows taskbar'ında böyle bir konvansiyon YOK → o ikon ~%19 küçük görünüyordu.
    Çözüm: `app-icon-windows.svg` (tam taşan, çubuklar 1024/832 ölçekli) → yalnız
    `icons/icon.ico` ondan üretilir. **Üretim sırası (bozma):**
    ```bash
    cp src-tauri/icons/icon.icns /tmp/mac.icns          # macOS'unkini sakla
    npm run tauri icon src-tauri/app-icon-windows.svg   # HER ŞEYİ üretir
    cp /tmp/mac.icns src-tauri/icons/icon.icns          # .icns'i geri koy
    ```
    Doğrulama: `.ico` orta satırda ilk opak piksel x=0 (%0 boşluk), `.icns` x=24 (%9.4).
    PNG'lerin tam-taşan olması Windows için doğru, macOS `.icns` kullandığı için zararsız.
21. **UI logosu = `src/components/Logo.tsx`** (ikonun 7 çubuğu), `◈` karakteri DEĞİL.
    `currentColor` kullanır → sarmalayıcının `text-accent`'ini alır.
22. **Ambiyansta ana içerik unmount edilir** (App.tsx `{!idle && …}`): RAM'İ DÜŞÜRMEZ
    (WebKit heap high-water mark, RSS'i geri vermez — ölçüldü, 122MB sabit). FAYDA
    CPU/PİL: ambiyanstayken playback-tick tüm UI'yı değil yalnız Screensaver'ı
    render eder (arka planda oyun senaryosu için değerli).
23. **Veri güvenliği:** açılışta veri varsa otomatik DB yedeği (son 12, `backups/`), tek-örnek koruması TÜM
    build'lerde. Geçmişte iki-instance yarışından şüphelenilen bir veri kaybı yaşandı; önlemler o yüzden.

## Özellikler (v1.2.0 — hepsi canlı)
**Temel:** çalma/kuyruk, canlı arama (debounce), playlist CRUD + paylaşım kodu (`RSNC1:…`), karma
(biriken oy + saatlik cooldown + decay), sözler, uyku zamanlayıcı, toplu indirme, .dmg + .exe CI
(`.github/workflows/release.yml`), yedek/geri yükle, veri içe/dışa aktarma (JSON, birleştirmeli).

**Keşif & öneri:**
- **Keşfet** (`startDiscovery`): playlist'siz, tamamen öneriyle ilerleyen sonsuz keşif modu. Sidebar'dan
  tek tık; açılışta **prewarm** sayesinde anında başlar, sıra paneli otomatik açılır, sıradaki **~20 şarkı
  hep dolu ve önden indirilmiş** tutulur (`TARGET_QUEUE_AHEAD = 20`). Keşif zaten aktifken Keşfet'e basmak
  yeni sıra kurmaz, mevcut sırayı açar.
  - **"Başka tarz" (reroll)**: Sıra panelinin başlığında; gelen tarzı beğenmediysen mevcut seed
    sanatçıları dışlayıp yeni parti kurar. Başlıkta partinin tarzı yazar ("… tarzı").
  - Keşfet'te **oy vermek yalnız algoritmayı eğitir** — parça hiçbir listeye/İndirilenler'e eklenmez
    (bkz. gotcha #13: ama `ensureTrack` şart, yoksa oy hiç sayılmaz).
- **Akıllı karışık** (Spotify tarzı): karıştır butonu 3 durumlu — kapalı → karışık → **akıllı karışık**
  (karışık + öneri serpiştirme + sürekli besleme). Ayrı "Radyo" butonu kaldırıldı.
- Arka arkaya aynı sanatçı/tarz gelmesin diye `spreadByArtist()`.

**Konfor:**
- **Kaldığın yerden devam** (son şarkı + pozisyon, açılışta duraklatılmış gelir).
  **⭐ Keşfet aktifse TÜM kuyruk kaydedilir** (v1.2.2, `resumeState` içinde `mode:"discovery"` +
  queue + index + seedArtists): kapat-aç son Keşfet partisini aynen getirir, reroll atmadıkça
  değişmez. `restoreDiscovery` duraklatılmış kurar; play'e basınca kaldığı yerden devam.
- **Ambiyans ekranı**: X sn etkileşimsizlikte çalan şarkıyı tam ekran gösterir (süre Ayarlar'dan, **"Özel…"**
  ile manuel dakika).
- **Arka plan FPS modu**: pencere odağı kaybedince animasyon/geçişler kapanır, tick saniyede 1'e iner
  (Windows'ta ikinci ekranda oyun oynarken FPS düşüşü içindi — azaltır, sıfırlamaz; webview maliyeti kalır).
- **Otomatik başlatma** (autostart), **medya tuşları** (kulaklık/klavye; macOS'ta F7/F9 sistem tarafından
  tutuluyor — F8 çalışır, Windows'ta üçü de çalışır), **oyu geri al** (toast'ta "Geri al"),
  **playlist içi arama**, **alt bardan indirme/oylama**, **komut paleti** (⌘/Ctrl+K),
  **sidebar aç/kapa** (⌘/Ctrl+B), **yt-dlp runtime güncelleme** (app_data/bin'e; ilk açılışta otomatik +
  Ayarlar'da buton).

**v1.2.0 — yeni:**
- **Dil: TR / EN** (`src/lib/i18n.ts`, Ayarlar → Görünüm). Anında değişir, yeniden başlatma yok.
  **Tip-güvenli:** `en` sözlüğü `Record<TrKey,string>` → eksik anahtar **derleme hatası**, gözle arama yok.
  React dışı için `t()` (store/recommender/toast), bileşenler için `useT()` (dil değişince re-render).
  Denetim: **`python3 scripts/i18n-check.py`** → UI'da kalan düz metni bulur (3 katman: UI öznitelikleri
  + JSX metni + Türkçe literaller; DİLDEN BAĞIMSIZ — "Sonraki"/"Tekrar"da Türkçe harf yok, dil tespiti
  bu yüzden güvenilmez). Çıktıdaki `Promise<>`/`else`/`finally`/`Türkçe`/`English`/`Wyclaew` yanlış pozitif.
- **Açık tema** (`:root[data-theme="light"]`, index.css). Koyu/açık/sistem; "sistem" OS'u CANLI izler.
  ⚠️ **Vurgu rengi açık temada koyulaştırılır** (`darken(accent, 0.62)`, App.tsx): kehribar beyazda
  ~1.9:1 kontrast veriyordu. Inline style stylesheet'i ezdiği için CSS'teki override'a güvenilemez.
  ⚠️ `isLight`'ı DOM'dan (`data-theme`) OKUMA — vurgu efekti tema efektinden ÖNCE çalışır, ilk
  render'da öznitelik yazılmamış olur. Doğrudan `theme` ayarından hesapla.
- **İlk açılış rehberi** (`src/components/Onboarding.tsx`): 6 adım, atlanabilir,
  `settings.onboardingDone` ile bir kez. Test için: `DELETE FROM settings WHERE key='app.onboardingDone';`
- **İmza:** Ayarlar → Hakkında'da "YAPAN **Wyclaew**". Ayrıca `package.json` `author` +
  `Cargo.toml` `authors`.

**İçe aktarma:**
- YouTube / YouTube Music: anahtarsız. Kimliksiz ~100 öğe sınırı var → tam liste için Ayarlar →
  Entegrasyonlar'dan tarayıcı seçilir (`--cookies-from-browser`).
- **Spotify anahtarsız (v1.1.0 — yeni)**: `open.spotify.com/embed/playlist/<id>` → `__NEXT_DATA__` JSON
  (`props.pageProps.state.data.entity` → `name`, `trackList[]`). Link yapıştırmak yeterli.
  **SINIR: ≤100 şarkı** (embed'in tavanı; ölçüldü: 50'lik liste tam, ~150'lik liste 100'de kesiliyor).
  Daha uzun listelerin tamamı için Ayarlar'dan **opsiyonel** ücretsiz API anahtarı (Client Credentials);
  anahtar varsa önce API denenir, hata verirse anahtarsız yola düşülür.

## Sırada / ertelenenler
- **Mobil + senkron** → `docs/MOBILE.md` (detaylı plan; ayrı sohbette yapılacak) + `docs/SYNC.md`.
  **Platform kararı: ANDROID** (kullanıcı netleştirdi; iOS kapsam dışı).
- **Yetim `play_history` kayıtları (104)**: `tracks`'te olmadıkları için öğrenmeye katılmıyorlar.
  yt-dlp ile metadata çekilip kurtarılabilir. Uygulama KAPALIYKEN + yedek alarak yapılmalı.
- Gerçek **streaming** (ffmpeg PCM pipe → rodio): kullanıcı şimdilik istemedi.
- **Equalizer** (rodio'da DSP gerektirir — en zoru), mini/menubar player.
- Öneri havuzu darsa (az oy/az geçmiş) 20 hedefine ulaşamayabilir; sinyal çeşitliliğine bağlı.
