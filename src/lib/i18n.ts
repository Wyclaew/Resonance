import { useSettingsStore } from "../store/useSettingsStore";

// Resonance çeviri katmanı (TR/EN).
//
// Tasarım:
//  • Tek düz sözlük (iç içe nesne yok) → eksik anahtar TİP HATASI verir:
//    `en` sözlüğü `tr` anahtarlarının TAMAMINI içermek ZORUNDA (Record<TrKey,…>).
//    Böylece "çevrilmeyen nokta" derleme zamanında yakalanır, gözle aranmaz.
//  • `t()` React DIŞINDA da çalışır (store, recommender, toast'lar) — dili
//    doğrudan settings store'dan okur.
//  • Bileşenlerde `useT()` kullan: dil değişince yeniden render olsun.
//  • Parametreler {süslü} ile: t("player.voteCooldown", { mins: 12 })

export type Lang = "tr" | "en";

const tr = {
  // — Gezinme / sidebar
  "nav.now": "Şu An",
  "nav.discover": "Keşfet",
  "nav.search": "Ara",
  "nav.library": "Kütüphane",
  "nav.downloads": "İndirilenler",
  "nav.import": "İçe Aktar",
  "nav.settings": "Ayarlar",
  "nav.playlists": "Çalma Listeleri",
  "nav.newPlaylist": "Yeni çalma listesi",
  "nav.preparing": "Hazırlanıyor…",
  "nav.expand": "Genişlet",
  "nav.noPlaylists":
    "Henüz çalma listen yok. Bir tane oluştur veya Spotify/YouTube Music'ten içe aktar.",
  "nav.collapse": "Daralt",

  // — Oynatıcı / alt bar
  "player.notPlaying": "Çalmıyor",
  "player.searchAndPlay": "Bir şarkı ara ve oynat",
  "player.goToPlaying": "Çalan yere git",
  "player.previous": "Önceki",
  "player.next": "Sonraki",
  "player.play": "Oynat",
  "player.pause": "Duraklat",
  "player.shuffleOff": "Karışık kapalı",
  "player.shuffleOn": "Karışık",
  "player.shuffleSmart": "Akıllı karışık — Resonance önerileriyle",
  "player.repeatOff": "Tekrar kapalı",
  "player.repeatAll": "Tümünü tekrarla",
  "player.repeatOne": "Bu şarkıyı tekrarla",
  "player.downloading": "İndiriliyor…",
  "player.downloaded": "İndirildi — kaldır",
  "player.downloadedClick": "İndirildi — kaldırmak için tıkla",
  "player.download": "İndir",
  "player.queue": "Sıra",
  "player.lyrics": "Sözler",
  "player.mute": "Sessize al",
  "player.unmute": "Sesi aç",
  "player.liked": "Beğenildi",
  "player.disliked": "Beğenilmedi",
  "player.undo": "Geri al",
  "player.voteCooldown": "Bu şarkı için {mins} dk sonra tekrar oy verebilirsin",
  "player.trackFailed": "Şarkı çalınamadı, atlanıyor",
  "player.loadFailed": "Şarkı yüklenemedi, atlanıyor",
  "player.playFailed": "Şarkı çalınamadı",
  "player.smartShuffleNeedsList": "Akıllı karışık için bir listeden çal",

  // — Karma / oylama
  "karma.voteHere": "Bu listede bu şarkıyı oyla",
  "karma.cooldown": "Şarkı başına saatte 1 oy — {mins} dk sonra tekrar",

  // — Sıra paneli
  "queue.title": "Sıra",
  "queue.upcomingCount": "{count} sıradaki",
  "queue.nowPlaying": "ŞİMDİ ÇALIYOR",
  "queue.upcoming": "SIRADAKİLER",
  "queue.empty": "Kuyruk boş. Bir şarkı veya çalma listesi çal.",
  "queue.noMore": "Sırada başka şarkı yok.",
  "queue.pickBadge": "Öneri",
  "queue.reroll": "Başka tarz",
  "queue.rerollHint": "Bu tarzı beğenmedim — başka tarz getir",
  "queue.styleOf": "{artists} tarzı",
  "queue.jumpTo": "Bu şarkıya atla",
  "queue.remove": "Sıradan çıkar",
  "queue.loading": "Yükleniyor",
  "queue.playing": "Çalıyor",
  "queue.paused": "Duraklatıldı",
  "queue.newStyle": "Yeni tarz: {artists}",
  "queue.newBatch": "Yeni keşif partisi hazır",
  "queue.noOtherStyle": "Başka tarz bulunamadı — daha fazla şarkıya oy ver",

  // — Şu An (Home)
  "home.goodMorning": "Günaydın",
  "home.goodDay": "İyi günler",
  "home.goodEvening": "İyi akşamlar",
  "home.goodNight": "İyi geceler",
  "home.subtitle": "Gün ve saate göre, kaldığın yerden devam et.",
  "home.contextHint":
    "Şu an {time} · {day}. Oy verdikçe öneriler bu bağlama göre keskinleşir.",
  "home.discoveryTitle": "Resonance Keşfi",
  "home.discoveryPreparing": "Keşif hazırlanıyor…",
  "home.discoveryDesc": "Zevkini öğrenen algoritma, sana göre yeni şarkılar çalsın — sonsuz keşif.",
  "home.recent": "Son çalınanlar",
  "home.yourPlaylists": "Çalma listelerin",
  "home.discoverSomething": "Yeni bir şey keşfet → Ara",
  "home.startSearching": "Aramaya başla",
  "home.emptyState":
    "Henüz veri yok. Bir şarkı arayıp çalmaya, çalma listeleri oluşturup oy vermeye başla — algoritma hangi gün ve saatte neyi sevdiğini öğrenip burayı sana göre dolduracak.",
  "home.smartShuffleHint": "Bu listeden akıllı karışık başlat (öneriler serpiştirilir)",
  "home.noData": "Yeterli veri yok — birkaç şarkıya oy vererek başla",

  // — Arama
  "search.title": "Ara",
  "search.placeholder": "Ne dinlemek istersin?",
  "search.recent": "Son aramalar",
  "search.hint": "YouTube üzerinde şarkı, sanatçı veya albüm ara — yazdıkça gelir.",
  "search.tauriOnly": "Arama yalnızca uygulama içinde çalışır (web önizlemesi değil).",
  "search.noResults": "Sonuç bulunamadı.",

  // — Kütüphane / İndirilenler
  "library.title": "Kütüphane",
  "library.subtitle": "Çalma listelerin ve indirdiklerin.",
  "library.newList": "Yeni liste",
  "library.emptyState":
    "Henüz çalma listen yok. \"Yeni liste\" ile oluştur ya da İçe Aktar'dan Spotify / YouTube Music listesi getir.",
  "downloads.title": "İndirilenler",
  "downloads.subtitle": "İnternet olmadan da çalabileceğin şarkılar",
  "downloads.count": "{count} şarkı çevrimdışı kullanıma hazır",
  "downloads.emptyState":
    "Henüz indirilmiş şarkın yok. Arama sonuçlarında veya çalma listelerinde indir ikonuna basınca şarkılar burada birikir.",

  // — Çalma listesi
  "playlist.title": "Çalma Listesi",
  "playlist.trackCount": "{count} şarkı",
  "playlist.searchInList": "Bu listede ara…",
  "playlist.playAll": "Tümünü çal",
  "playlist.allDownloaded": "Tüm şarkılar indirildi",
  "playlist.downloadAll": "Tümünü çevrimdışı için indir (indirilenleri atlar)",
  "playlist.sortByKarma": "Elle sıralı — karmaya göre sırala",
  "playlist.sortManual": "Karmaya göre sıralı — elle sıraya dön",
  "playlist.order": "Sıra",
  "playlist.karma": "Karma",
  "playlist.rename": "Yeniden adlandır",
  "playlist.share": "Paylaş",
  "playlist.shareTitle": "Listeyi paylaş",
  "playlist.shareDesc": "Bu kodu kopyalayıp paylaş. Karşı taraf \"İçe Aktar\"a yapıştırıp listenin kopyasını alır.",
  "playlist.copy": "Kopyala",
  "playlist.copied": "Kopyalandı",
  "playlist.removeFromList": "Listeden çıkar",
  "playlist.untitled": "İsimsiz liste",
  "playlist.selectOne": "Bir çalma listesi seç.",
  "playlist.downloadedAll": "İndirildi",
  "playlist.downloadAllBtn": "Tümünü indir",
  "playlist.deleteList": "Listeyi sil",
  "playlist.emptyBefore": "Bu liste boş. Arama sonuçlarında veya başka bir listede şarkıların yanındaki",
  "playlist.emptyAfter": "ile buraya ekle.",
  "playlist.noMatchFor": "\"{query}\" için sonuç yok.",
  "playlist.deleteConfirmTitle": "Listeyi sil?",
  "playlist.deleteConfirmBody": "\"{name}\" kalıcı olarak silinecek. Şarkılar silinmez.",
  "backup.readFailed": "Dosya okunamadı — geçerli bir Resonance yedeği değil.",
  "backup.invalid": "Desteklenmeyen veya bozuk yedek dosyası.",
  "backup.importedList": "İçe aktarılan liste",

  // — İçe aktarma
  "import.title": "İçe Aktar",
  "import.subtitle":
    "Spotify / YouTube Music çalma listesi linkini ya da Resonance paylaşım kodunu yapıştır.",
  "import.button": "İçe Aktar",
  "import.detected": "Algılandı: {source}",
  "import.srcSpotify": "Spotify çalma listesi",
  "import.srcYtMusic": "YouTube Music çalma listesi",
  "import.srcYouTube": "YouTube çalma listesi",
  "import.srcCode": "Resonance paylaşım kodu",
  "import.invalid": "Geçerli bir Spotify/YouTube Music linki veya Resonance kodu değil.",
  "import.invalidLong": "Geçerli bir çalma listesi bağlantısı veya Resonance kodu değil.",
  "import.reading": "Çalma listesi okunuyor…",
  "import.matching": "YouTube'da eşleştiriliyor…",
  "import.adding": "Şarkılar ekleniyor…",
  "import.createFailed": "Liste oluşturulamadı.",
  "import.codeFailed": "Paylaşım kodu çözülemedi (bozuk olabilir).",
  "import.tauriOnly": "İçe aktarma yalnızca uygulama içinde çalışır.",
  "import.done": "{count} şarkı \"{name}\" listesine eklendi.",
  "import.openList": "Listeyi aç",
  "import.partial":
    "Bu listede {total} şarkı var ama {count} tanesi alınabildi. YouTube giriş yapılmadan en fazla ~100 şarkı veriyor (ya da liste özel). Tümünü almak için Ayarlar → Entegrasyonlar'dan YouTube tarayıcını seç, sonra tekrar dene.",
  "import.howTitle": "Nasıl çalışır?",
  "import.howYt":
    "YouTube / YouTube Music çalma listeleri anahtarsız, doğrudan içe aktarılır. Paylaşım kodu (RSNC1:…) ile bir arkadaşının listesini uygulamana kopyalayabilirsin. Ses YouTube'dan çalar.",
  "import.howSpotifyBold": "Spotify de anahtarsız",
  "import.howSpotify":
    " — herkese açık bir listenin linkini yapıştırman yeterli. Spotify'ın sesi alınamadığı için şarkılar YouTube'da eşleştirilip oradan çalar.",
  "import.howSpotifyNote":
    "Not: Anahtarsız yol bir listeden en fazla 100 şarkı okur. Daha uzun listelerin tamamı için Ayarlar → Entegrasyonlar'dan tek seferlik ücretsiz Spotify anahtarı girebilirsin (opsiyonel).",

  // — Ayarlar: kategoriler
  "settings.title": "Ayarlar",
  "settings.catAccount": "Hesap & Senkron",
  "settings.catPlayback": "Oynatma",
  "settings.catStorage": "Depolama & Önbellek",
  "settings.catShortcuts": "Kısayollar",
  "settings.catIntegrations": "Entegrasyonlar",
  "settings.catAppearance": "Görünüm",
  "settings.catRecommendation": "Resonance Önerisi",
  "settings.catData": "Veri & Yedek",
  "settings.catAbout": "Hakkında",

  // — Ayarlar: öneri
  "settings.recTitle": "Resonance önerileri",
  "settings.recDesc": "Çalma listesi dinlerken araya önerilen şarkılar eklensin.",
  "settings.recYouTube": "YouTube'dan benzer",
  "settings.recYouTubeDesc":
    "Sevdiğin şarkı ve sanatçıların YouTube Music radyosundan benzerlerini bulur. Yeni keşif.",
  "settings.recLibrary": "Kendi playlistlerim",
  "settings.recLibraryDesc":
    "Diğer çalma listelerin ve indirdiklerin arasından o anki bağlama uyanları önerir.",
  "settings.karmaHalfLife": "Karma yarı ömrü",
  "settings.karmaHalfLifeDesc":
    "Oyların ne kadar sürede yarı değere düşeceği (gün). Düşük = daha hızlı unutur.",
  "settings.days": "gün",
  "settings.recSourcesHeader": "Öneriler nereden gelsin?",
  "settings.recNoSource": "En az bir kaynak açık olmalı, yoksa öneri gelmez.",
  "settings.karmaHeader": "Karma",
  "settings.recIntro":
    "Resonance, hangi gün ve saatte neyi dinlediğini ve oyladığını öğrenir; çalma listelerin de sinyal sayılır. Bu öneriler \"✦ Resonance\" rozetiyle işaretlenir; dilersen geçersin.",
  "settings.ytCookiesIntro":
    "YouTube, giriş yapılmadan bir çalma listesinin en fazla ~100 şarkısını verir ve özel listelere izin vermez. Tarayıcını seçersen uygulama, o tarayıcıdaki YouTube oturumunu (çerezleri) kullanır: tüm şarkılar (100+), özel listelerin ve daha az bot engeli. Çerezler cihazında kalır, hiçbir yere gönderilmez.",
  "settings.spotifyIntro":
    "Spotify'ın sesi alınamaz; bir Spotify listesini içe aktarınca şarkı adları okunur ve YouTube'da eşleştirilip oradan çalınır. Anahtar gerekmez — İçe Aktar'a herkese açık listenin linkini yapıştırman yeterli.",
  "settings.spotifyOptional":
    "Aşağıdaki alanlar opsiyonel: anahtarsız yol bir listeden en fazla 100 şarkı okur. Daha uzun listelerin tamamını almak istersen developer.spotify.com adresinden tek seferlik ücretsiz bir anahtar gir:",

  // — Ayarlar: entegrasyonlar
  "settings.cookiesBrowser": "Hesap için tarayıcı",
  "settings.cookiesBrowserDesc":
    "Hangi tarayıcıdaki YouTube oturumun kullanılsın? O tarayıcıda YouTube'a giriş yapmış olmalısın.",
  "settings.off": "Kapalı",
  "settings.updateYtdlp": "İndirme aracını güncelle",
  "settings.updateYtdlpDesc":
    "Şarkı indirilemiyor/çalmıyorsa genelde yt-dlp eskimiştir (YouTube sık değişir). Bu, en güncel sürümü indirir. İlk açılışta otomatik de denenir.",
  "settings.updating": "Güncelleniyor…",
  "settings.update": "Güncelle",
  "settings.spotifyIdPlaceholder": "örn. 4a1b…",
  "settings.spotifySecretHint": "Gizli tut; kimseyle paylaşma.",

  // — Ayarlar: oynatma
  "settings.rememberVolume": "Ses düzeyini hatırla",
  "settings.rememberVolumeDesc": "Uygulama en son ses düzeyiyle açılır.",
  "settings.prefetch": "Sıradakini önceden indir",
  "settings.prefetchDesc":
    "Bir sonraki şarkıyı arka planda hazırlar → geçiş anlık olur. Biraz daha veri kullanır.",
  "settings.autostart": "Bilgisayar açılışında başlat",
  "settings.autostartDesc": "Windows/macOS oturumu açıldığında Resonance otomatik çalışsın.",

  // — Ayarlar: depolama
  "settings.tempCache": "Geçici önbellek",
  "settings.tempCacheDesc":
    "Çaldığın ama indirmediğin şarkılar. Silmek güvenli; gerekince yeniden alınır.",
  "settings.downloadsKept": "İndirilenler",
  "settings.downloadsKeptDesc":
    "Çevrimdışı için kalıcı tuttukların. Önbellek temizlemede silinmez.",
  "settings.clearCache": "Önbelleği temizle",

  // — Ayarlar: kısayollar
  "settings.scPlayPause": "Oynat / Duraklat",
  "settings.scSeek": "5 sn ileri / geri",
  "settings.scVolume": "Ses +/−",
  "settings.scMute": "Sessize al",
  "settings.scIntro": "Uygulama açıkken (yazı kutuları hariç) geçerli kısayollar:",
  "settings.scNote": "Medya tuşları uygulama arka plandayken de çalışır.",
  "settings.sec30": "30 saniye",
  "settings.min1": "1 dakika",
  "settings.min15": "1.5 dakika",
  "settings.min3": "3 dakika",
  "settings.min5": "5 dakika",
  "settings.scSpace": "Boşluk",
  "settings.scNextPrev": "Sonraki / Önceki şarkı",
  "settings.scPalette": "Komut paleti (hızlı gezinme)",
  "settings.scSidebar": "Yan paneli aç/kapat",
  "settings.scMediaKeys": "Medya tuşları",
  "settings.scMediaKeysDesc":
    "Kulaklık/klavye oynat-duraklat-geç (uygulama arka plandayken de)",

  // — Ayarlar: görünüm
  "settings.accentColor": "Vurgu rengi",
  "settings.accentColorDesc": "Butonlar ve etkin öğelerdeki vurgu rengi.",
  "settings.amber": "Kehribar",
  "settings.green": "Yeşil",
  "settings.blue": "Mavi",
  "settings.red": "Mercan",
  "settings.purple": "Mor",
  "settings.pink": "Pembe",
  "settings.theme": "Tema",
  "settings.themeDesc": "Koyu, açık ya da sistem ayarını takip et.",
  "settings.themeDark": "Koyu",
  "settings.themeLight": "Açık",
  "settings.themeSystem": "Sistem",
  "settings.language": "Dil",
  "settings.languageDesc": "Uygulama arayüzünün dili.",
  "settings.screensaver": "Ambiyans ekranı",
  "settings.screensaverDesc":
    "Bu kadar süre etkileşim olmazsa ekran yalnızca çalan şarkıyı gösterir (dinlenme/ambiyans modu). Hareket edince kapanır.",
  "settings.custom": "Özel…",
  "settings.minutes": "dk",

  // — Ayarlar: veri
  "settings.version": "Sürüm",
  "about.tagline":
    "Hafif, karma tabanlı kişisel müzik oynatıcı. Ses YouTube'dan (yt-dlp) gelir; Spotify / YouTube Music listeleri içe aktarılır.",
  "about.disclaimer":
    "Kişisel kullanım içindir. YouTube'dan ses çekmek YouTube Hizmet Şartları'na aykırı olabilir; bu uygulamayı kendi sorumluluğunda kullan.",
  "about.builtWith": "Tauri · React · rodio · yt-dlp · ffmpeg ile yapıldı.",
  "about.madeBy": "Yapan",
  // — Hesap & Senkron
  "account.soonTitle": "Bulut senkronu — yakında",
  "account.soonBody":
    "Yakında bir hesapla giriş yapıp çalma listelerin, oyların/karman ve ayarların masaüstü ve telefon arasında otomatik senkronlanacak. Ses her cihazda yerel kalır; buluta yalnızca metadata gider. Şu an her şey tamamen yerel ve gizli — senkron açıldığında bile isteğe bağlı (opt-in) olacak.",
  "account.signInSoon": "Giriş yap (yakında)",
  "account.thisDevice": "Bu cihaz",
  "account.deviceDesc": "Senkron açıldığında bu cihazı tanımak için kullanılacak kimlik.",
  "account.planNote":
    "Planın tamamı depoda docs/SYNC.md ve docs/MOBILE.md dosyalarında: Supabase tabanlı hesap + delta senkron, mobil için React Native (Android).",
  // — Veri & Yedek
  "data.intro":
    "Çalma listelerin, oyların/karman bir JSON dosyasına yedeklenir (İndirilenler klasörüne). Bu dosyayı başka bir cihazda ya da bir arkadaşınla içe aktararak tüm listeleri paylaşabilirsin. Ses dosyaları dahil değildir — şarkılar her cihazda ilk çalmada otomatik indirilir. (Ayarlar/gizli anahtarlar paylaşılmaz.)",
  "data.exportBackup": "Yedeği dışa aktar",
  "data.saved": "Kaydedildi: {path}",
  "data.imported": "İçe aktarıldı: {playlists} liste, {tracks} şarkı, {votes} oy.",
  "data.autoBackups": "Otomatik yedekler",
  "data.backupNow": "Şimdi yedekle",
  "data.autoBackupsDesc":
    "Veri varken her açılışta otomatik yedek alınır (son 12 tutulur). Bir sorun olursa buradan geri yükleyebilirsin.",
  "data.restoreTitle": "Yedeği geri yükle?",
  "data.restoreBody":
    "{date} tarihli yedek geri yüklenecek. Mevcut durumun da ayrıca yedeklenir. Uygulama yeniden başlar.",
  "data.restoreAndRestart": "Geri yükle & yeniden başlat",
  "data.importBtn": "İçe aktar",
  "data.importing": "İçe aktarılıyor…",
  "data.restore": "Geri yükle",
  "data.noBackups": "Henüz yedek yok.",

  // — Komut paleti
  "palette.placeholder": "Git… (görünüm veya çalma listesi ara)",
  "palette.view": "Görünüm",
  "palette.playlist": "Çalma listesi",
  "palette.noResults": "Sonuç yok.",

  // — Sözler
  "lyrics.title": "Sözler",
  "lyrics.notFound": "Bu şarkı için söz bulunamadı.",
  "lyrics.noTrack": "Çalan bir şarkı yok.",
  "lyrics.loading": "Sözler aranıyor…",

  // — Uyku zamanlayıcı
  "sleep.title": "Uyku zamanlayıcı",
  "sleep.minutes": "{n} dakika",
  "sleep.remaining": "{n} dk kaldı",

  // — Çalma listesine ekle
  "addTo.title": "Çalma listesine ekle",
  "addTo.newList": "Yeni liste oluştur",

  // — Öneri gerekçeleri (recommender.ts)
  "rec.badge": "Resonance önerisi",
  "rec.exhausted": "Şimdilik yeni öneri kalmadı — biraz sonra tekrar dene",
  "rec.newDiscovery": "{seed} tarzında yeni keşif: {artist}",
  "rec.contextual": "{day} bu saatlerde {seed} seviyorsun",
  "rec.favorite": "{day} bu saatlerde sevdiğin bir parça",
  "rec.fromPlaylist": "{seed} listendeki sanatçılardan biri",

  // — Günler
  "day.0": "Pazar",
  "day.1": "Pazartesi",
  "day.2": "Salı",
  "day.3": "Çarşamba",
  "day.4": "Perşembe",
  "day.5": "Cuma",
  "day.6": "Cumartesi",

  // — Genel
  "common.cancel": "Vazgeç",
  "common.close": "Kapat",
  "common.clear": "Temizle",
  "common.recsOff": "Öneriler kapalı — Ayarlar → Resonance Önerisi",
  "screensaver.hint": "Devam etmek için hareket et",
  "error.title": "Bir şeyler ters gitti",
  "error.body": "Beklenmedik bir arayüz hatası oluştu. \"Tekrar dene\"ye basabilir ya da uygulamayı yeniden başlatabilirsin. Verilerin güvende.",
  "error.retry": "Tekrar dene",

  // — Onboarding
  "onb.skip": "Atla",
  "onb.next": "İleri",
  "onb.back": "Geri",
  "onb.done": "Başla",
  "onb.step": "{n} / {total}",
  "onb.welcomeTitle": "Resonance'a hoş geldin",
  "onb.welcomeBody":
    "Zevkini öğrenen, hafif bir müzik oynatıcı. Kısaca neyin nerede olduğunu gösterelim — 30 saniye sürer.",
  "onb.discoverTitle": "Keşfet",
  "onb.discoverBody":
    "Playlist gerekmez. Tek tıkla, zevkine göre seçilmiş yeni şarkılar sonsuza dek çalar. Tarzı beğenmezsen sıra panelindeki \"Başka tarz\" ile değiştirebilirsin.",
  "onb.karmaTitle": "Oy ver, öğrensin",
  "onb.karmaBody":
    "Beğendiğin şarkıya 👍, sevmediğine 👎 ver. Algoritma hangi gün ve saatte neyi sevdiğini öğrenir; ayrıca çalma listelerin ve gerçekten dinlediğin şarkılar da sayılır.",
  "onb.importTitle": "Listelerini getir",
  "onb.importBody":
    "Spotify veya YouTube Music listelerinin linkini yapıştır — anahtar gerekmez. Ses YouTube'dan çalar.",
  "onb.downloadTitle": "Çevrimdışı dinle",
  "onb.downloadBody":
    "İndir simgesiyle şarkıları kalıcı olarak kaydet; internet olmadan da çalarlar. İndirilenler bölümünde toplanır.",
  "onb.shortcutsTitle": "Hızlı ipuçları",
  "onb.shortcutsBody":
    "⌘/Ctrl+K komut paletini, ⌘/Ctrl+B yan paneli açar. Boşluk oynat/duraklat. Kulaklık ve klavyendeki medya tuşları da çalışır.",
} as const;

export type TrKey = keyof typeof tr;

// `en` sözlüğü `tr`'nin TÜM anahtarlarını içermek ZORUNDA — eksik olursa tsc
// hata verir. "Çevrilmeyen nokta kalmasın" güvencesi budur.
const en: Record<TrKey, string> = {
  "nav.now": "Now",
  "nav.discover": "Discover",
  "nav.search": "Search",
  "nav.library": "Library",
  "nav.downloads": "Downloads",
  "nav.import": "Import",
  "nav.settings": "Settings",
  "nav.playlists": "Playlists",
  "nav.newPlaylist": "New playlist",
  "nav.preparing": "Preparing…",
  "nav.expand": "Expand",
  "nav.noPlaylists":
    "No playlists yet. Create one, or import from Spotify/YouTube Music.",
  "nav.collapse": "Collapse",

  "player.notPlaying": "Not playing",
  "player.searchAndPlay": "Search for a song and play it",
  "player.goToPlaying": "Go to current track",
  "player.previous": "Previous",
  "player.next": "Next",
  "player.play": "Play",
  "player.pause": "Pause",
  "player.shuffleOff": "Shuffle off",
  "player.shuffleOn": "Shuffle",
  "player.shuffleSmart": "Smart shuffle — with Resonance picks",
  "player.repeatOff": "Repeat off",
  "player.repeatAll": "Repeat all",
  "player.repeatOne": "Repeat this track",
  "player.downloading": "Downloading…",
  "player.downloaded": "Downloaded — remove",
  "player.downloadedClick": "Downloaded — click to remove",
  "player.download": "Download",
  "player.queue": "Queue",
  "player.lyrics": "Lyrics",
  "player.mute": "Mute",
  "player.unmute": "Unmute",
  "player.liked": "Liked",
  "player.disliked": "Disliked",
  "player.undo": "Undo",
  "player.voteCooldown": "You can vote on this track again in {mins} min",
  "player.trackFailed": "Couldn't play the track, skipping",
  "player.loadFailed": "Couldn't load the track, skipping",
  "player.playFailed": "Couldn't play the track",
  "player.smartShuffleNeedsList": "Play from a playlist to use smart shuffle",

  "karma.voteHere": "Vote on this track in this playlist",
  "karma.cooldown": "One vote per track per hour — try again in {mins} min",

  "queue.title": "Queue",
  "queue.upcomingCount": "{count} up next",
  "queue.nowPlaying": "NOW PLAYING",
  "queue.upcoming": "UP NEXT",
  "queue.empty": "The queue is empty. Play a track or a playlist.",
  "queue.noMore": "Nothing else up next.",
  "queue.pickBadge": "Pick",
  "queue.reroll": "Different style",
  "queue.rerollHint": "Not feeling this style — bring me another",
  "queue.styleOf": "{artists} style",
  "queue.jumpTo": "Jump to this track",
  "queue.remove": "Remove from queue",
  "queue.loading": "Loading",
  "queue.playing": "Playing",
  "queue.paused": "Paused",
  "queue.newStyle": "New style: {artists}",
  "queue.newBatch": "New discovery batch ready",
  "queue.noOtherStyle": "No other style found — vote on more tracks",

  "home.goodMorning": "Good morning",
  "home.goodDay": "Good afternoon",
  "home.goodEvening": "Good evening",
  "home.goodNight": "Good night",
  "home.subtitle": "Tuned to your day and hour — pick up where you left off.",
  "home.contextHint":
    "It's {time} · {day}. The more you vote, the sharper your picks get for this context.",
  "home.discoveryTitle": "Resonance Discovery",
  "home.discoveryPreparing": "Preparing discovery…",
  "home.discoveryDesc":
    "Let the algorithm that learns your taste play new music for you — endless discovery.",
  "home.recent": "Recently played",
  "home.yourPlaylists": "Your playlists",
  "home.discoverSomething": "Discover something new → Search",
  "home.startSearching": "Start searching",
  "home.emptyState":
    "No data yet. Start by searching for a track, creating playlists and voting — the algorithm will learn what you like on each day and hour, and fill this page for you.",
  "home.smartShuffleHint": "Start smart shuffle from this playlist (picks mixed in)",
  "home.noData": "Not enough data yet — start by voting on a few tracks",

  "search.title": "Search",
  "search.placeholder": "What do you want to listen to?",
  "search.recent": "Recent searches",
  "search.hint": "Search YouTube for a song, artist or album — results appear as you type.",
  "search.tauriOnly": "Search only works inside the app (not the web preview).",
  "search.noResults": "No results found.",

  "library.title": "Library",
  "library.subtitle": "Your playlists and downloads.",
  "library.newList": "New playlist",
  "library.emptyState":
    "No playlists yet. Create one with \"New playlist\", or bring a Spotify / YouTube Music playlist in from Import.",
  "downloads.title": "Downloads",
  "downloads.subtitle": "Tracks you can play without an internet connection",
  "downloads.count": "{count} tracks ready for offline listening",
  "downloads.emptyState":
    "No downloads yet. Hit the download icon in search results or playlists and tracks will collect here.",

  "playlist.title": "Playlist",
  "playlist.trackCount": "{count} tracks",
  "playlist.searchInList": "Search in this playlist…",
  "playlist.playAll": "Play all",
  "playlist.allDownloaded": "All tracks downloaded",
  "playlist.downloadAll": "Download all for offline (skips existing)",
  "playlist.sortByKarma": "Manual order — sort by karma",
  "playlist.sortManual": "Sorted by karma — back to manual order",
  "playlist.order": "Order",
  "playlist.karma": "Karma",
  "playlist.rename": "Rename",
  "playlist.share": "Share",
  "playlist.shareTitle": "Share playlist",
  "playlist.shareDesc": "Copy and share this code. The other person pastes it into \"Import\" to get a copy of the playlist.",
  "playlist.copy": "Copy",
  "playlist.copied": "Copied",
  "playlist.removeFromList": "Remove from playlist",
  "playlist.untitled": "Untitled playlist",
  "playlist.selectOne": "Pick a playlist.",
  "playlist.downloadedAll": "Downloaded",
  "playlist.downloadAllBtn": "Download all",
  "playlist.deleteList": "Delete playlist",
  "playlist.emptyBefore": "This playlist is empty. Add tracks with the",
  "playlist.emptyAfter": "next to them in search results or another playlist.",
  "playlist.noMatchFor": "No results for \"{query}\".",
  "playlist.deleteConfirmTitle": "Delete playlist?",
  "playlist.deleteConfirmBody": "\"{name}\" will be permanently deleted. The tracks are not deleted.",
  "backup.readFailed": "Couldn't read the file — not a valid Resonance backup.",
  "backup.invalid": "Unsupported or corrupted backup file.",
  "backup.importedList": "Imported playlist",

  "import.title": "Import",
  "import.subtitle":
    "Paste a Spotify / YouTube Music playlist link, or a Resonance share code.",
  "import.button": "Import",
  "import.detected": "Detected: {source}",
  "import.srcSpotify": "Spotify playlist",
  "import.srcYtMusic": "YouTube Music playlist",
  "import.srcYouTube": "YouTube playlist",
  "import.srcCode": "Resonance share code",
  "import.invalid": "Not a valid Spotify/YouTube Music link or Resonance code.",
  "import.invalidLong": "Not a valid playlist link or Resonance code.",
  "import.reading": "Reading playlist…",
  "import.matching": "Matching on YouTube…",
  "import.adding": "Adding tracks…",
  "import.createFailed": "Couldn't create the playlist.",
  "import.codeFailed": "Couldn't decode the share code (it may be corrupted).",
  "import.tauriOnly": "Importing only works inside the app.",
  "import.done": "{count} tracks added to \"{name}\".",
  "import.openList": "Open playlist",
  "import.partial":
    "This playlist has {total} tracks but only {count} could be fetched. Without signing in, YouTube returns at most ~100 tracks (or the playlist is private). To get them all, pick your YouTube browser under Settings → Integrations and try again.",
  "import.howTitle": "How does it work?",
  "import.howYt":
    "YouTube / YouTube Music playlists import directly, no key needed. With a share code (RSNC1:…) you can copy a friend's playlist into your app. Audio streams from YouTube.",
  "import.howSpotifyBold": "Spotify needs no key either",
  "import.howSpotify":
    " — just paste the link to a public playlist. Spotify's audio can't be fetched, so tracks are matched on YouTube and played from there.",
  "import.howSpotifyNote":
    "Note: the keyless path reads at most 100 tracks from a playlist. For longer playlists you can add a one-time free Spotify key under Settings → Integrations (optional).",

  "settings.title": "Settings",
  "settings.catAccount": "Account & Sync",
  "settings.catPlayback": "Playback",
  "settings.catStorage": "Storage & Cache",
  "settings.catShortcuts": "Shortcuts",
  "settings.catIntegrations": "Integrations",
  "settings.catAppearance": "Appearance",
  "settings.catRecommendation": "Resonance Picks",
  "settings.catData": "Data & Backup",
  "settings.catAbout": "About",

  "settings.recTitle": "Resonance picks",
  "settings.recDesc": "Mix recommended tracks in while you listen to a playlist.",
  "settings.recYouTube": "Similar on YouTube",
  "settings.recYouTubeDesc":
    "Finds similar tracks from the YouTube Music radio of the songs and artists you like. New discoveries.",
  "settings.recLibrary": "My own playlists",
  "settings.recLibraryDesc":
    "Suggests tracks from your other playlists and downloads that fit the current context.",
  "settings.karmaHalfLife": "Karma half-life",
  "settings.karmaHalfLifeDesc":
    "How long until a vote decays to half its value (days). Lower = forgets faster.",
  "settings.days": "days",
  "settings.recSourcesHeader": "Where should picks come from?",
  "settings.recNoSource": "At least one source must be on, otherwise you get no picks.",
  "settings.karmaHeader": "Karma",
  "settings.recIntro":
    "Resonance learns what you listen to and vote on, and at which day and hour; your playlists count as a signal too. These picks are marked with the \"✦ Resonance\" badge; skip them whenever you like.",
  "settings.ytCookiesIntro":
    "Without signing in, YouTube returns at most ~100 tracks of a playlist and won't allow private ones. If you pick your browser, the app uses that browser's YouTube session (cookies): all tracks (100+), your private playlists, and fewer bot checks. Cookies stay on your device and are never sent anywhere.",
  "settings.spotifyIntro":
    "Spotify's audio can't be fetched; when you import a Spotify playlist the track names are read, matched on YouTube, and played from there. No key needed — just paste a public playlist link into Import.",
  "settings.spotifyOptional":
    "The fields below are optional: the keyless path reads at most 100 tracks from a playlist. To get longer playlists in full, add a one-time free key from developer.spotify.com:",

  "settings.cookiesBrowser": "Browser for account",
  "settings.cookiesBrowserDesc":
    "Which browser's YouTube session should be used? You must be signed in to YouTube in that browser.",
  "settings.off": "Off",
  "settings.updateYtdlp": "Update the download tool",
  "settings.updateYtdlpDesc":
    "If tracks won't download or play, yt-dlp is usually outdated (YouTube changes often). This fetches the latest version. It's also tried automatically on first launch.",
  "settings.updating": "Updating…",
  "settings.update": "Update",
  "settings.spotifyIdPlaceholder": "e.g. 4a1b…",
  "settings.spotifySecretHint": "Keep it secret; don't share it with anyone.",

  "settings.rememberVolume": "Remember volume",
  "settings.rememberVolumeDesc": "The app opens at the volume you last used.",
  "settings.prefetch": "Prefetch next track",
  "settings.prefetchDesc":
    "Prepares the next track in the background → switching is instant. Uses a little more data.",
  "settings.autostart": "Launch at startup",
  "settings.autostartDesc": "Start Resonance automatically when you sign in to Windows/macOS.",

  "settings.tempCache": "Temporary cache",
  "settings.tempCacheDesc":
    "Tracks you played but didn't download. Safe to clear; they're fetched again when needed.",
  "settings.downloadsKept": "Downloads",
  "settings.downloadsKeptDesc":
    "Tracks you keep for offline listening. Clearing the cache won't delete these.",
  "settings.clearCache": "Clear cache",

  "settings.scPlayPause": "Play / Pause",
  "settings.scSeek": "Seek 5s forward / back",
  "settings.scVolume": "Volume +/−",
  "settings.scMute": "Mute",
  "settings.scIntro": "Shortcuts available while the app is open (except in text fields):",
  "settings.scNote": "Media keys work even while the app is in the background.",
  "settings.sec30": "30 seconds",
  "settings.min1": "1 minute",
  "settings.min15": "1.5 minutes",
  "settings.min3": "3 minutes",
  "settings.min5": "5 minutes",
  "settings.scSpace": "Space",
  "settings.scNextPrev": "Next / Previous track",
  "settings.scPalette": "Command palette (quick navigation)",
  "settings.scSidebar": "Toggle sidebar",
  "settings.scMediaKeys": "Media keys",
  "settings.scMediaKeysDesc":
    "Headphone/keyboard play-pause-skip (even while the app is in the background)",

  "settings.accentColor": "Accent color",
  "settings.accentColorDesc": "The accent color on buttons and active items.",
  "settings.amber": "Amber",
  "settings.green": "Green",
  "settings.blue": "Blue",
  "settings.red": "Coral",
  "settings.purple": "Purple",
  "settings.pink": "Pink",
  "settings.theme": "Theme",
  "settings.themeDesc": "Dark, light, or follow your system setting.",
  "settings.themeDark": "Dark",
  "settings.themeLight": "Light",
  "settings.themeSystem": "System",
  "settings.language": "Language",
  "settings.languageDesc": "The language of the app interface.",
  "settings.screensaver": "Ambient screen",
  "settings.screensaverDesc":
    "After this much time without interaction, the screen shows only the current track (rest/ambient mode). Move to dismiss.",
  "settings.custom": "Custom…",
  "settings.minutes": "min",
  "settings.version": "Version",
  "about.tagline":
    "A lightweight, karma-based personal music player. Audio comes from YouTube (yt-dlp); Spotify / YouTube Music playlists can be imported.",
  "about.disclaimer":
    "For personal use. Fetching audio from YouTube may conflict with YouTube's Terms of Service; use this app at your own risk.",
  "about.builtWith": "Built with Tauri · React · rodio · yt-dlp · ffmpeg.",
  "about.madeBy": "Made by",
  "account.soonTitle": "Cloud sync — coming soon",
  "account.soonBody":
    "Soon you'll be able to sign in and have your playlists, votes/karma and settings sync automatically between desktop and phone. Audio stays local on each device; only metadata goes to the cloud. Right now everything is fully local and private — and sync will be opt-in even once it ships.",
  "account.signInSoon": "Sign in (coming soon)",
  "account.thisDevice": "This device",
  "account.deviceDesc": "The ID that will identify this device once sync is enabled.",
  "account.planNote":
    "The full plan lives in the repo under docs/SYNC.md and docs/MOBILE.md: Supabase-backed account + delta sync, React Native (Android) for mobile.",
  "data.intro":
    "Your playlists and votes/karma are backed up to a JSON file (in your Downloads folder). You can import that file on another device — or share it with a friend to pass on all your playlists. Audio files are not included; tracks download automatically on first play on each device. (Settings and secret keys are not shared.)",
  "data.exportBackup": "Export backup",
  "data.saved": "Saved: {path}",
  "data.imported": "Imported: {playlists} playlists, {tracks} tracks, {votes} votes.",
  "data.autoBackups": "Automatic backups",
  "data.backupNow": "Back up now",
  "data.autoBackupsDesc":
    "A backup is taken automatically on every launch while you have data (the last 12 are kept). If something goes wrong, you can restore from here.",
  "data.restoreTitle": "Restore backup?",
  "data.restoreBody":
    "The backup from {date} will be restored. Your current state is backed up too. The app will restart.",
  "data.restoreAndRestart": "Restore & restart",
  "data.importBtn": "Import",
  "data.importing": "Importing…",
  "data.restore": "Restore",
  "data.noBackups": "No backups yet.",

  "palette.placeholder": "Go to… (search views or playlists)",
  "palette.view": "View",
  "palette.playlist": "Playlist",
  "palette.noResults": "No results.",

  "lyrics.title": "Lyrics",
  "lyrics.notFound": "No lyrics found for this track.",
  "lyrics.noTrack": "Nothing is playing.",
  "lyrics.loading": "Looking for lyrics…",

  "sleep.title": "Sleep timer",
  "sleep.minutes": "{n} minutes",
  "sleep.remaining": "{n} min left",

  "addTo.title": "Add to playlist",
  "addTo.newList": "Create new playlist",

  "rec.badge": "Resonance pick",
  "rec.exhausted": "No new picks right now — try again in a bit",
  "rec.newDiscovery": "New find in {seed}'s style: {artist}",
  "rec.contextual": "You like {seed} around this time on {day}",
  "rec.favorite": "A track you love around this time on {day}",
  "rec.fromPlaylist": "One of the artists in your {seed} playlist",

  "day.0": "Sunday",
  "day.1": "Monday",
  "day.2": "Tuesday",
  "day.3": "Wednesday",
  "day.4": "Thursday",
  "day.5": "Friday",
  "day.6": "Saturday",

  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.clear": "Clear",
  "common.recsOff": "Picks are off — Settings → Resonance Picks",
  "screensaver.hint": "Move to continue",
  "error.title": "Something went wrong",
  "error.body": "An unexpected interface error occurred. You can hit \"Try again\" or restart the app. Your data is safe.",
  "error.retry": "Try again",

  "onb.skip": "Skip",
  "onb.next": "Next",
  "onb.back": "Back",
  "onb.done": "Get started",
  "onb.step": "{n} / {total}",
  "onb.welcomeTitle": "Welcome to Resonance",
  "onb.welcomeBody":
    "A lightweight music player that learns your taste. Let's show you where things are — takes 30 seconds.",
  "onb.discoverTitle": "Discover",
  "onb.discoverBody":
    "No playlist needed. One click and it plays new music picked for your taste, forever. Don't like the style? Hit \"Different style\" in the queue panel.",
  "onb.karmaTitle": "Vote, and it learns",
  "onb.karmaBody":
    "Give 👍 to tracks you like and 👎 to ones you don't. The algorithm learns what you enjoy on each day and hour — your playlists and what you actually listen to count too.",
  "onb.importTitle": "Bring your playlists",
  "onb.importBody":
    "Paste a link to your Spotify or YouTube Music playlist — no key needed. Audio streams from YouTube.",
  "onb.downloadTitle": "Listen offline",
  "onb.downloadBody":
    "Use the download icon to keep tracks permanently; they play without internet. You'll find them under Downloads.",
  "onb.shortcutsTitle": "Quick tips",
  "onb.shortcutsBody":
    "⌘/Ctrl+K opens the command palette, ⌘/Ctrl+B toggles the sidebar. Space plays/pauses. Your headphone and keyboard media keys work too.",
};

const DICTS: Record<Lang, Record<TrKey, string>> = { tr, en };

// Sistem dilini tahmin et (ilk açılış için). Türkçe değilse İngilizce.
export function detectLang(): Lang {
  if (typeof navigator === "undefined") return "tr";
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function translate(
  lang: Lang,
  key: TrKey,
  params?: Record<string, string | number>
): string {
  const s = DICTS[lang]?.[key] ?? tr[key] ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, p) =>
    p in params ? String(params[p]) : m
  );
}

// React DIŞI kullanım (store, recommender, toast). Dili anlık okur.
export function t(key: TrKey, params?: Record<string, string | number>): string {
  return translate(useSettingsStore.getState().language, key, params);
}

// Bileşenler için: dil değişince yeniden render olur.
export function useT() {
  const lang = useSettingsStore((s) => s.language);
  return (key: TrKey, params?: Record<string, string | number>) =>
    translate(lang, key, params);
}

// Gün adı (0=Pazar) — hem TR hem EN.
export function dayNameOf(lang: Lang, dow: number): string {
  return translate(lang, `day.${dow}` as TrKey);
}
