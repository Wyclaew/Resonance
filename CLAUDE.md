# Resonance — Proje Kılavuzu (yeni oturum için handoff)

Hafif, **karma tabanlı kişisel müzik oynatıcı**. Mac & Windows masaüstü (mobil planlandı:
`docs/MOBILE.md`). Ses YouTube'dan gelir; Spotify/YouTube Music listeleri içe aktarılır.
Tamamen yerel/gizli (sunucu yok). Kullanıcı: Eren. **İletişim dili: Türkçe.**

**Durum: v1.8.4** — masaüstü olgun ve günlük kullanımda. Mac'te sorunsuz; Windows'ta bilinen
tüm indirme/çalma sorunları çözüldü. Açık kritik bug yok.
v1.2.0'da: öğrenme sinyalleri genişledi (playlist üyeliği), TR/EN dil, açık tema, ilk açılış rehberi.
v1.2.1'de: **OS medya oturumu** (souvlaki) — macOS F7/F9 ve Windows'ta oyun açıkken
medya tuşları artık çalışıyor; kilit ekranında şarkı bilgisi. Ayrıca çerçevesiz pencere,
UI'da gerçek logo (◈ değil), Windows'a ÖZEL tam-taşan ikon.
v1.2.2'de: Windows CI build fix (`raw-window-handle` dep), **Keşfet kuyruğu kalıcı** (kapat-aç
hatırlar, reroll'a kadar sabit), öneri gerekçesi YAPISAL (dil değişince çevrilir), playlist
ekleme/oluşturma toast'ları, çeşitli i18n düzeltmeleri.
v1.3.0'da: **BULUT SENKRONU** (Mac ↔ Windows canlı) — migration v5, `src/lib/sync/`,
Supabase + RLS + Realtime. Ayrıntı: aşağıdaki "Senkron" bölümü ve `docs/SYNC.md`.
Ayrıca **KEŞFET YENİDEN TASARLANDI**: kendi sayfası (panel değil), tür/ruh hali
filtreleri, oturum modu (mod-uyarlamalı öneri) ve yanlış-tuş algılama —
aşağıdaki "Keşfet" bölümü.
v1.8.4'te: ⭐ **İNDİRİCİ "HER ŞARKIYI BİR ŞEKİLDE İNDİR" SEVİYESİNE ÇIKTI**:
• **ADRES SAĞLIK TESTİ** (`native_dl::probe_url`) — indirmeye başlamadan önce
  dosyanın SON 1 KB'ı istenir. ÖLÇÜM: kısıtlı adres (PO Token'sız InnerTube)
  403 (0.16 sn), kısıtsız adres 206 (0.07 sn). Eskiden bu ayrım ancak 1 MB
  indirip 403 yiyerek anlaşılıyordu → şarkı başına 1 MB veri + ~1 sn israf,
  artık SIFIR (log: "adres kısıtlı (sağlık testi)").
• **ALTERNATİF KAYNAK** (`ytdlp::find_alternative`) — TÜM katmanlar tükenirse
  şarkıyı atlamak yerine AYNI ŞARKININ BAŞKA YÜKLEMESİ aranır (başlık+sanatçı,
  süre ±%20 + mix/podcast filtresi). Bulunursa çalınır ve `track-relinked`
  olayıyla `tracks.source_id` GÜNCELLENİR — yoksa her çalışta aynı ölü video
  yeniden denenirdi. ⚠️ `tracks.id` DEĞİŞMEZ: değişseydi playlist üyelikleri,
  oylar ve dinleme geçmişi parçadan kopardı.
• **ISITMADA TEKRAR YOK** — `prewarm_urls` artık önbellekte adresi olanları
  süzer; eskiden `prefetchNext` her şarkıda aynı 8 şarkı için yt-dlp'yi
  yeniden çalıştırıyordu (~16 sn boşa iş).
v1.8.3'te: **KENDİ MÜZİK DOSYALARIN** (`localFiles.ts` + `ytdlp::scan_local`:
dosya/klasör seç → ffprobe ile etiket oku → `source='local'` olarak tracks'e;
dosyalar KOPYALANMAZ, yerinde çalınır. ⚠️ rodio m4a/opus çözemiyor →
`ensure_local_audio` bunları BİR KEZ ADTS'ye çevirip önbelleğe koyar, kaynağa
dokunmaz. ⚠️ `sourceId` = dosya yolu → senkronda tracks satırı gider ama ses
gitmez, diğer cihazda çalmaz: bilinçli); **SANATÇI SAYFASI** (`ArtistView`,
sanatçı adı ilk kez tıklanabilir: geçmişin + parçaları + radyosu + daha
çok/az/engelle); **AKILLI LİSTELER** (`smartLists.ts` — kalıcı playlist satırı
YOK, her açılışta play_history'den hesaplanır → senkron yükü yok, hep güncel);
**ŞARKI DETAYI** (sağ tık: kaç kez çaldın/tamamladın/atladın + saat dağılımı;
eşikler öneri motorununkiyle AYNI); **SÖZDEN ŞARKI BULMA** (lrclib arama ucu →
bulunan şarkı YouTube'da aranıp çalınır); **MİNİ OYNATICI** (`?mini=1` ile aynı
frontend, ikinci pencere, hep üstte; ⚠️ AYRI JS bağlamı — store paylaşılmaz,
komutlar `mini-command` olayıyla ana pencereye gider); **SON SORUNLAR** (toast
4 sn'de kayboluyordu, tekrar eden hata iz bırakmıyordu → Ayarlar'da sayaçlı
liste); **KUYRUK SONU DAVRANIŞI** (öneriyle devam / tekrarla / dur);
**UYKUDA FADE-OUT + "şarkı bitince dur"**; geçiş boşluğu küçüldü (şarkı kendi
bitince 180 ms'lik debounce ATLANIR — o gecikme doğrudan sessizliğe dönüşüyordu).
v1.8.2'de: **CROSSFADE** (`AudioCmd::Load{fade_ms}` + audio.rs'te sönen sink
listesi; parça bitmeye fade süresi kala frontend `next("ended")` çağırır —
"ended" ŞART, yoksa crossfade her şarkıya haksız ATLAMA cezası yazardı.
Varsayılan KAPALI: iki parça birlikte çalar, albüm/gapless dinleyeni rahatsız
edebilir); **AKILLI TAMPON** (`native_dl::health` son 20 indirmenin hızını ve
başarı oranını ölçer → tampon 3-8 arası kendi ayarlanır; sabit 5 yerine);
**"BÖYLE DEVAM ET"** (`moreLikeThis`: çalanı bozmadan SIRADAKİLERİ o tarza
çevirir + artist_prefs'e kalıcı "daha çok" yazar — tarz kilidi tüm partiyi
yeniden kuruyordu); **KARAOKE VURGUSU** (aktif satırda okunan kısım vurgu
rengiyle dolar, uzak satırlar kademeli solar).
v1.8.1'de: ⭐ **İNDİRİRKEN ÇALMA** (progressive playback, `native_dl::stream_to_adts`
+ `GrowingFile` + `AudioCmd::Load{growing}`): indirilen baytlar ffmpeg'e BORUDAN
verilir, ffmpeg ADTS yazar, ses motoru dosyayı BÜYÜRKEN okur. ÖLÇÜLDÜ (entegrasyon
testi `cargo test --lib progressive -- --ignored`): **ilk ses 1.1 sn → 0.33 sn**.
⚠️ Akış yolu InnerTube adresini KULLANMAZ — test tam bunu yakaladı: o adres 1 MB'da
403 veriyor ve akışta bu "şarkı ortasında sesin kesilmesi" demek. Yalnız kısıtsız
adresler (önbellek/yt-dlp). ⚠️ "medium" kalite akışta desteklenmez (yeniden kodlama
gerekir, akışta `-c:a copy` kullanılıyor) → normal yola düşer. ⚠️ Geçici
`*.stream.aac` dosyaları AÇILIŞTA silinir (`cleanup_stream_files`) — tamamlanınca
nihai ada kopyalanır, taşınmaz (dosya ses motorunda açık olabilir, Windows'ta
taşıma başarısız olurdu).
v1.8.1'de: **yt-dlp HAFTALIK OTOMATİK GÜNCELLEME** (eskiden yalnız İLK açılışta
iniyordu; YouTube ayda birkaç kez değişiyor → eskiyen yt-dlp'de indirme sessizce
çöküyor, Windows'ta "hiçbir şarkı açılmıyor" tablosunun en olası sebebi);
**İNDİRME TEŞHİS PANELİ** (Ayarlar → Entegrasyonlar → "İndirme sorunu mu var?":
yt-dlp/ffmpeg yolu+sürümü, yerel adres çözümü, gerçek test indirmesi, nerede
kırıldığını söyleyen SONUÇ satırı — arayüzde log ekranı olmadığı için tek teşhis
aracı); **ÇEVRİMDIŞI TAMPON 2→5 şarkı** (yerel indirici sayesinde artık şarkı
başına yt-dlp süreci başlamıyor, eşzamanlılık maliyeti düştü);
**CİHAZ KUYRUĞU SEÇİCİ** (`DeviceQueuePicker`, Keşfet başlığında "Başka cihaz" →
hangi cihazın sırasını getireceğini SEÇ; otomatik devralma "en yeni"yi alıyordu,
üç cihazda yetmiyordu); **ANA SAYFA** ("Şu an sana göre" — saat profilinin
tahmini + tek tıkla o tarzda keşif; "Bu haftanın keşifleri" — son 7 günde İLK KEZ
dinlenen sanatçılar).
v1.8.0'da: ⭐⭐ **YEREL İNDİRİCİ** (`src-tauri/src/native_dl.rs`: InnerTube ile
URL çözme + parçalı/devam eden Range indirici; yt-dlp artık yalnız URL çözücü
rolünde, indirmeyi biz yapıyoruz — ölçüldü: duvar indirmede değil URL
çözümünde); **İNDİRME ÇOK YOLLU** (YouTube bot doğrulaması + PO Token →
varsayılan istemci 403/"not a bot" veriyordu; ÖLÇÜLDÜ: `web_embedded` audio-only
m4a ile 4/4 kurtardı → sıra `web_embedded → default → mweb → tv_simply → çerez`
+ "en son işe yarayan yolu ilk dene"); **ZEVK PROFİLİ SAYFASI** (`TasteView`,
modelin içi + sanatçı başına daha çok/az/engelle, migration v8 `artist_prefs`
SENKRONLANIR); **öneri kalitesi ölçümü** (haftalık kabul oranı — ölçüldü: %35);
**sanatçı komşuluk grafiği** (`artist_edges`, radyo sonuçlarının %90'ı çöpe
gidiyordu → yakınlık komşulara yayılıyor, havuz kütüphane dışına çıktı);
**tekrar dinleme sinyali**; **ses seviyesi eşitleme** (`measure_loudness`,
ffmpeg loudnorm, hedef −14 LUFS + tepe koruması); **kuyruğu listeye kaydet**;
**SEÇMELİ AYAR SENKRONU** (`settings` beyaz liste) + **`device_queue`**
(Keşfet kuyruğu cihazlar arası; artık açılışta doğrudan oynatıcıya yüklenir);
**senkron sıklığı düştü** (yerel değişiklik yalnız PUSH/8sn, realtime yalnız
PULL/4sn, tam tur 10dk); **İNTERAKTİF TUR** (spotlight + sayfa gezdirme);
**YILLIK ÖZET** (`WrappedView`, paylaşılabilir); Keşfet UX (sıra düğmesi
Keşfet'te gizli, eski keşfet paneli kaldırıldı, "Yeni keşif" filtresizken gri,
"Rastgele" filtre seçiliyken pasif, mod etiketi sanatçı yerine tür/ruh hali);
playlist'te **3 seçenekli oynat çekmecesi** (sıralı/rastgele/önerili) +
`playNow` artık `shuffleMode`'u yok saymıyor (BUG'DI: akıllı karışık seçiliyken
sırayla çalıyordu).
v1.7.0'da: **"bu sanatçıyı önerme"** (migration v7 `blocked_artists`, SENKRONLANIR →
PC'de engellediğin telefonda da gelmez; Ayarlar → Resonance Önerisi'nden geri alınır),
**tarz kilidi** (`lockedSeedArtist`, tohum ağırlığı ×8), **otomatik çevrimdışı indirme**
(en çok dinlenen N şarkı; varsayılan KAPALI çünkü indirilenler budamadan muaf),
istatistiklerde **haftalık özet + "yeni keşfedilen sanatçı"** sayacı.
v1.6.3'te: **senkronda tablo başına hata yalıtımı** (bulutta `now_playing` yokken
TÜM senkron duruyordu — tek tablo artık turu iptal etmiyor) + anlaşılır
"şemayı yeniden çalıştır" mesajı + `scripts/sync-schema-check.py`;
**öneri kabul oranı** (`src/lib/acceptance.ts`) öğrenmeye dördüncü katman.
v1.6.2'de: **AYARLAR PROFİL MENÜSÜNE GİRDİ** (sidebar'dan kalktı) ve tema/dil
Ayarlar'dan ÇIKARILDI → tek yerde: profil menüsü. ⚠️ Tema orada 3 DURUMLU
döngüdür (koyu→açık→sistem); "sistem" başka hiçbir yerde kalmadı.
Ayarlar'a ikinci erişim: komut paleti (⌘K).
v1.6.1'de: profil SIDEBAR ALTINA taşındı (başlık şeridindeki 24px düğme hem
küçüktü hem sürükleme bölgesiyle çakışıyordu); **Hesap & Senkron Ayarlar'dan
ÇIKARILDI** → kendi sayfası (`AccountView`, `ViewId="account"`), yalnız profil
menüsünden açılır; menüye hızlı tema/dil geçişi; ses kalitesine **Orta** (~96k,
ffmpeg ile yeniden kodlama — YouTube 49k/130k dışında kademe SUNMUYOR);
"başka cihazda kaldığın yer" artık POZİSYONDAN devam ediyor.
v1.6.0'da: **PROFİL & ÇAPRAZ CİHAZ** — sağ üstte profil menüsü (avatar, senkron
durumu, çıkış), **dinleme etkinliği/analiz sayfası** (`StatsView`, play_history'den
→ cihazlar arası ortak), **migration v6 `now_playing`** (PC'de bırak-telefonda
devam; cihaz başına satır → çakışma yok), ses kalitesi ayarı (düşük ≈ 3× küçük
dosya), uygulama içi **şifre sıfırlama** (localhost bağlantısını yapıştır).
v1.5.0'da: **ZAMAN-BAĞLAMLI ZEVK PROFİLİ** (`src/lib/taste.ts`) — "bu saatte ne
dinlersin" tahmini, GÜVEN ile ölçekli (aşağıda); **önbellek LRU budama** (sınırsız
büyüyordu, ölçüldü 1.1 GB); filtre başına kişisel radyo 2→1 ("Journey" sızıntısı);
30 filtre (14 yeni); "Şu An"daki işlevsiz Keşfet kartı kaldırıldı.
v1.4.0'da: **Keşfet filtreleri GERÇEKTEN çalışıyor** — tür havuzu YouTube Music'in
küratörlü listelerinden geliyor (`music_genre_pool`); sanatçı tekrarı kesildi
(parti başına 1); giriş/kayıt ayrı sekme + şifre tekrarı + şifre sıfırlama;
filtre paneli açılır-kapanır.
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
- **Görünümler** (`src/views/`): Home (Şu An), **Discover (Keşfet)**, Search, Library,
  Downloads, Playlist, Import, **Stats (dinleme analizi)**, **Account (hesap & senkron)**, Settings.
  ⚠️ Account/Stats sidebar'da DEĞİL — yalnız profil menüsünden (sidebar altı) açılır.
- **Sidebar**: Şu An · **Keşfet** (GÖRÜNÜM: `navigate("discover")` + `startDiscovery()`) ·
  Ara · Kütüphane · İndirilenler · İçe Aktar · **profil satırı (altta)**.
  ⚠️ Ayarlar/Hesap/İstatistik sidebar'da DEĞİL — profil menüsünden açılır (⌘K de çalışır).
- **Oynatıcı** (`src/store/usePlayerStore.ts` — en büyük dosya): kuyruk, `playNow`, `startSmartShuffle`,
  `startDiscovery`, `refillRadio`, `restoreState`, uyku zamanlayıcı, medya tuşları, prefetch.
  Ses motoruna Tauri komutlarıyla bağlı; pozisyon `playback-tick` olayıyla gelir.
- **Rust komutları** (`src-tauri/src/commands.rs`): search_youtube, **music_radio** (öneri kaynağı), **music_genre_pool** (YT Music küratörlü tür listeleri),
  import_playlist, import_spotify,
  get_lyrics, play_track, download_audio, prefetch_audio, delete_audio, is_cached, cache_files,
  delete_cache_except, export_data, backup_db / list_backups / restore_backup, update_ytdlp, read_log,
  audio_play/pause/seek/stop/set_volume/status.
- **Yerel indirici** (`native_dl.rs`): InnerTube URL çözümü + Range'li, devam edebilen indirici (3 katmanlı akışın 1. ve 2. katmanı).
- **Ses motoru** (`audio.rs`): rodio Sink, AudioCmd kanalı, `catch_unwind` ile çözümleme paniğine dayanıklı.
  `Load{start_ms}` ile kaldığın yerden devam.
- **yt-dlp/ffmpeg** (`ytdlp.rs`): `resolve_bin()` sırası → sistem → **app_data/bin (runtime güncellenen)** →
  sidecar → PATH.
- **Öneri** (`src/lib/recommender.ts`): tek skorlama modeli (aşağıda ayrı bölüm).
- **Senkron** (`src/lib/sync/`, v1.3.0): Supabase tabanlı bulut senkronu (aşağıda ayrı bölüm).
- **DB tabloları:** tracks, playlists, playlist_tracks(+vote), votes (olay günlüğü), play_history,
  cache(+downloaded), settings, **recommendation_history**, **sync_state**.
  Migration'lar: v1 ilk şema, v2 downloaded,
  v3 current_vote, v4 recommendation_history, **v5 senkron iskeleti**, **v6 now_playing**,
  **v7 blocked_artists**, **v8 artist_prefs + artist_edges + artist_tags +
  track_loudness + device_queue + settings senkron alanları**.

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
11e. **⭐ HIZ: DARBOĞAZ İNDİRME DEĞİL, ADRES ÇÖZÜMÜ** (v1.8.0). ÖLÇÜM
    (3.17 MB şarkı): yt-dlp ile adres çözümü **2.45 sn**, indirme yalnız
    0.79-1.08 sn. Yani "şarkıyı 3 yerinden paralel indir" fikri gerçek sorunu
    çözmez — ölçüldü: tek istek 0.79 sn · 1 MB sıralı 1.08 sn · **1 MB
    paralel×4 0.79 sn** (kazanç 0.29 sn). Yapılanlar:
    • **Tek istekte tam dosya** (≤24 MB) — parçalamanın faydası yokken istek
      sayısını 4'e katlamak anlamsız. Parçalı+paralel (4 eşzamanlı) yol yalnız
      tek istek reddedilirse ya da bağlantı koparsa devreye girer.
    • **⭐ ADRES ISITMA** (`prewarm_urls` + `native_dl` URL önbelleği):
      sıradaki 8 şarkının adresi TEK yt-dlp çağrısında önden çözülür
      (ölçüm: ayrı ayrı 2.50 sn/video → toplu 1.91 sn/video, üstelik arka
      planda). Kullanıcı ileri atlayınca çözüm beklemesi SIFIRA iner.
      ⚠️ Isıtma `dl_semaphore`'u KULLANMAZ (ayrı semafor): 9 şarkılık tur
      16 sn sürüyor, aynı semaforu paylaşsa gerçek indirmeleri bloke ederdi.
      ⚠️ `prefetchNext`e bağlı bırakılamaz — o yalnız şarkı yüklenirken çalışır;
      uygulama duraklatılmış açıldığında kuyruk hazır olmasına rağmen hiç
      ısınmazdı (`prewarmQueueUrls`, App.tsx'te resume sonrası da çağrılır).
11d. **⭐⭐ İNDİRME DÖRT KATMANLI — YEREL İNDİRİCİ ÖNCE** (v1.8.0, `native_dl.rs`):
    Kullanıcı "neredeyse her şarkıda yüklenemedi" dedi. ÖLÇÜM (2026-08-19,
    gerçek isteklerle):
    • Kendi InnerTube çağrım (IOS/ANDROID): player yanıtı OK, ses URL'si geliyor,
      ama **ilk 1 MB iniyor, sonrası 403** (PO Token yok).
    • Kendi InnerTube (WEB_EMBEDDED/MWEB/TVHTML5): player yanıtı bile yok.
    • **yt-dlp'nin ÇÖZDÜĞÜ URL + elle Range istekleri: p1 206, p2 206, tam 200 →
      KISITSIZ.**
    ⭐ ÇIKARIM: duvar İNDİRMEDE değil, **URL ÇÖZÜMÜNDE**. Buna göre sıra:
      0. **Önbellekteki adres** (`native_dl::cached_source`) — ısıtmadan gelen
         hazır adres. En hızlı yol; yt-dlp de çalışmaz, boşa indirme de olmaz.
      1. `native_dl::fetch` — InnerTube ile çöz + parçalı indir (yt-dlp süreci
         HİÇ başlamaz, ~1.5-3 sn tasarruf). Üst üste 3 başarısızlıkta 30 dk
         askıya alınır (boşuna 1 MB indirmesin).
      2. `resolve_url_with_ytdlp` (`-j`) + `native_dl::fetch_with_url` — URL'yi
         yt-dlp çözer, **baytları biz indiririz**. Pratikte kurtaran yol bu.
      3. yt-dlp'nin kendi indirmesi (aşağıdaki çok yollu strateji).
    ⚠️ `-j` bayrağı `--`'den ÖNCE gelmeli; sonra konursa pozisyonel argüman
    sayılır ve katman 2 SESSİZCE hiç çalışmaz (bu hata bir kez yapıldı).
    ⚠️ `.part` (yarım indirme) + `.part.meta` (devam mührü) dosyaları
    `<id>.src.` önekiyle eşleşiyor → `find_src` bunları ATLAMAK ZORUNDA, yoksa
    ffmpeg yarım dosyayı kaynak sanar.
    ⚠️ Devam (resume) YALNIZ aynı kaynakta geçerli: `.part.meta` mührü
    (content_length + URL kuyruğu) tutmuyorsa `.part` silinir — yoksa katman 1'in
    yarım dosyası üstüne katman 2'nin farklı baytları yazılıp ses BOZULUR.
11c. **⭐⭐ İNDİRME ÇOK YOLLU OLMALI — TEK İSTEMCİ YETMEZ** (v1.8.0, `ensure_audio`):
    YouTube bot doğrulaması + PO Token zorunluluğu getirdi; varsayılan istemci
    ya "Sign in to confirm you're not a bot" ya da bayt indirmede 403 döndürüyor.
    **ÖLÇÜM (2026-08-19):** default(android_vr) ❌ · tv ❌ · ios ❌ ·
    **web_embedded ✅ (audio-only m4a, 4/4)** · mweb ✅ (muxed 11MB) · tv_simply ✅.
    Sıra: `web_embedded → default → mweb → tv_simply → çerez`, + LAST_GOOD_STRATEGY
    ("en son işe yarayan yolu ilk dene") + 2 tur taze çıkarım.
    ⛔ **"Kendi ham indiricimizi yazalım" ÇÖZÜM DEĞİL**: duvarı aşan şey yt-dlp'nin
    imza/nsig JS çözücüsü ve istemci taklidi; elle HTTP indirici aynı 403'ü alır.
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

## ⭐ Keşfet (v1.3.0) — yeniden tasarım

**Kendi sayfası**: `src/views/DiscoverView.tsx`, `ViewId = "discover"`. Eskiden sıra
panelinin içindeydi (sağ üstte çarpı) — gezinince kapanıyordu. Normal çalmada
eski kuyruk paneli DURUYOR, yalnız Keşfet ayrıldı.
Sidebar `startDiscovery()` çağırır (force YOK) → sayfaya her girişte kuyruk
SIFIRLANMAZ; "Yeni keşif" düğmesi `{force:true}` ile yeni parti kurar.

### Tür / ruh hali filtreleri (`src/lib/filters.ts`)
- ⚠️ **Veritabanında TÜR ALANI YOK** — `tracks` yalnız başlık/sanatçı/süre tutar.
  Bu yüzden filtre tohumu ARAMAYLA üretilir.
- **⭐ TÜR HAVUZU İKİ AŞAMALIDIR** (`music_genre_pool`, Rust). Tek aşama ÇALIŞMIYOR:
  - `music.youtube.com/search?q=…` **VİDEO DÖNDÜRMEZ** — playlist (`VLRDCLAK5uy_…`),
    albüm (`MPREb_…`), kanal (`UC…`) kimlikleri döner, başlık/süre BOŞ. Bunları
    radyo tohumu sanmak sessizce BOŞ sonuç verir → filtre hiç çalışmaz, Keşfet
    kişisel havuza düşer. **"Türkçe seçtim tek Türkçe şarkı gelmedi" bug'ının
    kökü buydu** ve sessiz olduğu için fark edilmiyordu.
  - Çözüm: o `VL…` kimlikleri YouTube Music'in **küratörlü tür/ruh hali
    listeleridir**. `VL` öneki atılıp `playlist?list=RDCLAK5uy_…` çekilince tam
    metadata'lı gerçek şarkılar gelir (ölçüldü: "türkçe rock" → mor ve ötesi,
    Dedublüman, Pinhâni).
  - Yan fayda: jenerik metin aramasının getirdiği **telifsiz stok müzik**
    (Infraction/MokkaMusic) sorunu da kökten biter.
- **⭐ TÜR ETİKETİ KESİŞİMLE ÖĞRENİLİR**: DB'de tür alanı yok, kullanıcının hangi
  sanatçısının "rock" olduğunu bilmiyoruz. Havuzdaki sanatçılarla kütüphane
  sanatçılarını KESİŞTİRİNCE öğreniyoruz → o kesişimin radyosu "tanıdık
  sanatçının bilmediğin şarkısı"nı, havuzun kendisi "hiç bilmediğin sanatçı"yı
  getirir. Kullanıcının istediği karışım budur.
- **`effectiveArtist()`**: YT Music liste girdilerinde `artist` alanı KANAL adıdır
  ("MuzikPlay", "netd müzik"); gerçek sanatçı BAŞLIKTA ("Can Koç - …"). Çeşitlilik
  sayacı ve kesişim buna göre yapılmalı, yoksa tek kanal partiyi doldurur.
- **Sanatçı başına parti başına 1 parça** (eskiden 2 → kullanıcı "2 sanatçıdan
  4 şarkı geldi" dedi). Ayrıca yeni parti ÖNCEKİ partinin seed sanatçılarını dışlar.
- **Ruh hali × tür ÇAPRAZLANIR**: "Enerjik + Rock" → `energetic rock hits`.
  Ayrı sorgu yapılsaydı sonuç BİRLEŞİM olurdu (ölçüldü: rock filtresiyle aynı
  partide Gülben Ergen çıkıyordu). Aynı grup içinde çoklu seçim "veya"dır.
- Sorgularda **"songs" yerine "hits"** — stok müzik kanalları "… songs" ifadesine
  SEO yapıyor.
- **Karışık kaynak** (kullanıcı tercihi): tohumların çoğu filtreden, **1 tanesi**
  kullanıcının kendi yüksek yakınlıklı sanatçısından. (2 iken filtre seyreliyordu.)
  Ayrıca radyo sonuçları yakınlık-ağırlıklı karıştırılır → tanıdık tat öne gelir,
  tür bozulmaz.
- Filtreler **kalıcı Keşfet durumunda saklanır** — yoksa kapat-aç sonrası kuyruk
  geri gelir ama `refillRadio` filtresiz besler ve tür sessizce kaybolur.

### Oturum modu (`src/lib/mood.ts`)
- **Şikâyet**: bir partide yalnız 3-4 sanatçı radyosu → hep aynı tarz.
  **Çözüm**: radyo sayısı 3 → **6** (2 dalga × 3 eşzamanlı; yt-dlp sınırı
  EŞZAMANLILIKTA, toplamda değil) + mod çarpanı + prob.
- "Tarz" vekili = **`seedArtist`** (radyonun tohum sanatçısı). Tür alanı olmadığı
  için en iyi vekil bu.
- Sonuna kadar dinlenen tarz beslenir (`moodMultiplier` 0.35…2.0 ile yakınlık
  puanını ÇARPAR), hemen geçilen geriler. **Taban 0.35** — hiçbir tarz tamamen
  ölmez, yoksa keşif kapanır.
- **Prob** ("modun değişti mi?"): partide 1 tohum bilerek modu ÖLÇÜLMEMİŞ bir
  tarzdan seçilir → round-robin ile kuyrukta ~5-6 şarkıda 1 prob (kullanıcı
  tercihi "orta"). `QueueItem.isProbe` ile UI'da rozet.
- **KALICI DEĞİL** (kapanınca sıfırlanır) — bilerek: "mod" bugüne ait, kalıcı zevk
  zaten votes/play_history'de.
- ⛔ **`suppressMoodSignal()`**: çalma HATASI (indirilemedi) sonrası atlamada mod
  sinyali YAZILMAZ. Yoksa 403 indirme hatası "bu tarzı sevmedim" olarak
  öğreniliyordu.

### ⭐ Öneri kabul oranı (`src/lib/acceptance.ts`, v1.6.3)
"Önerdiğimde gerçekten dinleniyor mu?" — EKSİK OLAN GERİ BESLEME BUYDU.
- `recommendation_history` (ne önerdim) ⨝ `play_history` (ne dinledim) →
  sanatçı başına kabul oranı. İki tablo da senkronlanıyor → cihazlar arası ortak.
- **Neden diğer katmanlardan farklı:** `artistAffinity` "seviyorum" der ve
  playlist üyeliği onu güçlü besler; ama listendeki bir sanatçının RADYODAN
  gelen şarkılarını sürekli geçiyor olabilirsin. Eski model bunu göremiyordu ve
  o sanatçıyı tohum seçmeye devam ediyordu.
- Az veriyle etki kısılır (<4 öneri), taban 0.4 → kimse tamamen ölmez.
- Seed ağırlığı artık DÖRT katmanın çarpımı:
  `kalıcı zevk × oturum modu × zaman bağlamı × kabul oranı`.

### ⭐ Zaman-bağlamlı zevk profili (`src/lib/taste.ts`, v1.5.0)
"Hangi saat ne dinlediğime göre tahmin yapsın, tutmazsa onu da öğrensin."
- **YENİ TABLO YOK** — profil `play_history` + `tracks`'ten TÜRETİLİR. Bu iki tablo
  zaten senkronlanıyor → öğrenilen zevk cihazlar arası OTOMATİK ortak. Ayrı bir
  profil tablosu olsaydı sayaçları LWW ile birleştirmek gerekirdi ve iki cihazın
  öğrendiği birbirini EZERDİ.
- **Kova modeli**: hafta içi/sonu × günün 5 dilimi. Recommender'daki mevcut
  `contextWeight` (sürekli saat benzerliği) ile TAMAMLAYICI, aynı şey değil.
- **⭐ KENDİNİ DÜZELTEN GÜVEN** — istenen "tutmazsa öğrensin" budur:
  tahminin gücü, o kovadaki dinlemenin DERLİ TOPLULUĞUNA (entropi) bağlı.
  Hep aynı tarzları dinliyorsan güven yüksek → tahmin güçlü. Her seferinde başka
  şey dinliyorsan güven düşük → tahmin neredeyse hiç uygulanmaz. Ayrıca
  <20 dinlemede güven kısılır (birkaç örnekten zevk çıkarmak gürültüdür).
  Böylece ayrı bir "isabet/ıska defteri" tutmaya GEREK KALMAZ.
- Seed ağırlığı artık ÜÇ katmanın çarpımı:
  `kalıcı zevk × oturum modu (mood.ts) × zaman bağlamı (taste.ts)`.

### ⭐ Önbellek LRU budama (v1.5.0)
- **BUG'DI**: çalarken inen dosyalar `cache` TABLOSUNA YAZILMIYOR (oraya yalnız
  kullanıcının "indir" dedikleri girer) → geçici dosyaları hiçbir şey takip
  etmiyor, hiçbir şey temizleyemiyordu. Ölçüldü: **345 dosya / 1.1 GB**.
- Çözüm: `prune_cache` (Rust) diskten mtime'a göre budar; `downloaded=1` olanlar
  ASLA silinmez. Ayar: Depolama → Önbellek sınırı (varsayılan 2 GB, 0=sınırsız).
- ⚠️ Budama AYARLAR YÜKLENDİKTEN SONRA çağrılmalı — önce çağrılırsa store
  VARSAYILAN sınırı taşır ve kullanıcının seçtiği küçük sınır hiç uygulanmaz
  (bu hataya bir kez düşüldü).
- **Kaliteyi düşürmeden daha az veri MÜMKÜN DEĞİL**: opus daha verimli ama
  symphonia (rodio) opus çözemiyor → tek gerçek kaldıraç budama.

### ⭐ Yanlış tuş algılama (`recordOutgoing`, usePlayerStore)
Kullanıcı sevmediği şarkıyı geçmek için "sonraki"ye basacakken yanlışlıkla
"önceki"ye basıyor. Eski kod bunu TEK yanlış tuşla İKİ şarkıya birden haksız
ceza yazıyordu (geçilen + geri dönülen).
- `ExitReason` = ended | next | prev | jump.
- **prev/jump = GEZİNME, yargı DEĞİL** → 10 sn altındaki çıkışta HİÇBİR sinyal
  yazılmaz (ne play_history ne skip cezası ne mod).
- **Düzeltme penceresi**: "önceki"den sonra 8 sn içindeki "sonraki" de gezinmedir.
- Ceza YALNIZ gerçek atlamada (bilerek "sonraki").

## ⭐ Senkron (`src/lib/sync/`, v1.3.0) — bilmen gerekenler

Supabase (Postgres + Auth + RLS + Realtime). Sunucu kodu YOK. Tam anlatım:
**`docs/SYNC.md`**, sunucu şeması `docs/supabase-schema.sql`.
Kurulum: `src/lib/sync/config.ts`'e Project URL + **anon** key (boşsa senkron kapalı,
uygulama %100 yerel). ⛔ `service_role` anahtarı ASLA kullanılmaz (RLS'i bypass eder).

- **⭐ İKİ AYRI ZAMAN DAMGASI — karıştırma:**
  - `updated_at` (epoch ms, **CİHAZ** saati) → yalnız **çakışma çözümü** (LWW).
  - `synced_at` (timestamptz, **SUNUCU** saati, Postgres trigger) → yalnız **pull penceresi**.
  **Neden:** iki cihazın saati tutmaz; pencere cihaz saatine bağlansaydı saati geri kalan
  cihaz diğerinin satırlarını "gördüm" sanıp SONSUZA DEK atlardı.
- **⭐ TABLO BAŞINA HATA YALITIMI** (v1.6.3): `syncNow` her tabloyu ayrı
  try/catch ile işler. Eskiden düz `await` döngüsüydü → bulutta olmayan TEK
  tablo (`now_playing`) sonraki push'ları VE BÜTÜN PULL'LARI iptal ediyordu.
  Yeni sürüm tablo eklerse `docs/supabase-schema.sql` YENİDEN çalıştırılmalı;
  `scripts/sync-schema-check.py` sapmayı önceden yakalar.
- **⭐ SİLME = TOMBSTONE** (`deleted = 1`), hard delete YOK. Hard delete diğer cihaza
  "bu satır hiç yoktu" gibi görünür → silinen satır geri gelir.
  **Sonuç: HER OKUMA `deleted = 0` FİLTRELEMEK ZORUNDA.** (playlists.ts, recommender.ts,
  dışa aktarma.) Yeni sorgu yazarken bunu unutma — sessizce silinmiş veri gösterirsin.
  - `deletePlaylist` artık CASCADE'e güvenemez (satır silinmiyor) → `playlist_tracks`
    üyeliklerini de ELLE tombstone'lar.
  - `addTrackToPlaylist` tombstone'lu satırı `ON CONFLICT ... SET deleted=0` ile **diriltir**
    (yoksa "çıkar → geri ekle" PK hatası verirdi).
- **⭐ `uid`**: votes/play_history/recommendation_history `AUTOINCREMENT id` kullanıyor →
  iki cihaz KAÇINILMAZ olarak aynı id'yi üretir. `uid` (UUID) cihazdan bağımsız upsert
  anahtarıdır. Bu tablolara yazan HER yeni kod `uid` + `device_id` + `updated_at` vermeli
  (bkz. `newUid()`, `getDeviceId()` — `src/lib/device.ts`).
- **Yazma yolları** `notifyLocalChange()` çağırır (3 sn debounce → senkron). Senkron
  kapalıysa no-op, güvenle çağrılabilir.
- **Senkronlanmayanlar (bilerek):** `cache` (ses dosyaları cihaz-yerel) ve **`settings`'in
  tamamı** — içinde `resumeState` (Keşfet kuyruğu), cihaz kimliği, ses seviyesi var.
  Tema/dil de bu yüzden senkronlanmıyor.
- **Bulutta FK YOK** (bilerek): parçası henüz yüklenmemiş bir `playlist_tracks` satırı
  FK'lı şemada push'u komple patlatırdı. Tutarlılık yerelde korunur.
- **Pull hata toleransı:** bir satır hata verirse (tipik: ebeveyni gelmemiş FK) o tablonun
  su terazisi o satırdan ÖNCEYE sabitlenir → satır kaybolmaz, sonraki turda yeniden denenir.
- **İlk senkron yönü** kullanıcıya sorulur (`firstSyncPushAll` / `firstSyncPullReplace`),
  ikisinde de önce otomatik yedek. **"Buluttan al" `tracks`'i BİLEREK silmez** — `cache`
  tracks'e CASCADE bağlı, silinseydi indirilmiş dosya kayıtları da uçardı.

## Sırada / ertelenenler
- **Mobil (Android)** → `docs/MOBILE.md` (ayrı sohbette yapılacak). Senkron şeması + protokolü
  ARTIK HAZIR (`docs/SYNC.md`); mobil aynı şemayı kullanmalı, yeniden tasarlamamalı.
  **Platform kararı: ANDROID** (kullanıcı netleştirdi; iOS kapsam dışı).
- Seçmeli ayar senkronu (tema/dil) — şu an `settings` hiç senkronlanmıyor.
- **Yetim `play_history` kayıtları (104)**: `tracks`'te olmadıkları için öğrenmeye katılmıyorlar.
  yt-dlp ile metadata çekilip kurtarılabilir. Uygulama KAPALIYKEN + yedek alarak yapılmalı.
- Gerçek **streaming** (ffmpeg PCM pipe → rodio): kullanıcı şimdilik istemedi.
- **Equalizer** (rodio'da DSP gerektirir — en zoru), mini/menubar player.
- Öneri havuzu darsa (az oy/az geçmiş) 20 hedefine ulaşamayabilir; sinyal çeşitliliğine bağlı.
