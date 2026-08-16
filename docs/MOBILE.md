# Resonance Mobil — Detaylı Plan (ayrı sohbette uygulanacak)

Bu dosya, mobil uygulamayı **sıfırdan başka bir sohbette** yapacak olan için yazıldı.
Masaüstünün mimarisi ve tuzakları için önce **`CLAUDE.md`**'yi oku; senkron protokolü
`docs/SYNC.md`'de. Bu doküman "mobil nasıl yapılır"ı anlatır.

**Amaç:** Eren'in kendi kullanımı için mobil Resonance. Masaüstüyle **senkron**
(playlist, oy/karma, dinleme geçmişi, ayarlar). Ses yine YouTube'dan.
**Kişisel kullanım, mağazaya çıkmayacak, repo private.**

## ⭐ KARAR: ANDROID — iOS KAPSAM DIŞI
Kullanıcı netleştirdi: telefon **Android**. iOS'a hiç girme ("çok uğraştırır" —
haklı: App Store'a çıkamaz, sideload'da 7 günde bir yeniden imzalama gerekir).
Bu dokümanda iOS'a dair her şey silindi; tek hedef **Android**.

---

## 0. Önce kararlaştırılacak tek şey (Faz 0'da netleşmeli)

**Ses yolu** (§2) — projenin en riskli kararı. Faz 0'daki spike bunu doğrulamadan
arayüz kodu yazmaya başlama. (Platform sorusu kapandı: Android.)

---

## 1. Kısıtlar (masaüstünden farklı olan her şey)

| Konu | Masaüstü (mevcut) | Mobil (gerçek) |
| --- | --- | --- |
| Çıkarım aracı | `yt-dlp` (Python binary) | **Çalışmaz** — Android'de app içine gömülemez (Termux ayrı bir şey) |
| Ses motoru | Rust `rodio` + symphonia | Platform oynatıcı (**ExoPlayer**) — arka plan + kilit ekranı için ŞART |
| Arka plan çalma | Bedava (masaüstü) | **Foreground Service + MediaSession** gerekir |
| Depolama | Sınırsız sayılır | Sınırlı → indirme kotası + LRU temizlik gerekir |
| Ağ | Sabit | Mobil veri / offline → **offline-first ŞART**, indirme kotası mobil veride kapalı |
| Süreç ömrü | Uygulama açık kalır | OS istediğinde öldürür → durumu sık kaydet |

---

## 2. En kritik karar: ses nasıl gelecek?

### 2.1 Seçenekler (dürüst karşılaştırma)

| # | Yol | Nasıl | Artı | Eksi |
| --- | --- | --- | --- | --- |
| **A** | **Cihazda çıkarım (JS)** — `youtubei.js` (YouTube.js, NewPipe muadili, saf TS) ile stream URL'i al, `react-native-track-player` (ExoPlayer) ile çal | Telefon kendi başına yeter | PC gerekmez, tam bağımsız, arka plan/kilit ekranı hazır gelir | RN'de **imza çözme (signature decipher)** JS-motoru gerektirir; Hermes'te tökezleyebilir. **DOĞRULANMADI** → Faz 0 spike şart |
| **B** | **Cihazda çıkarım (native)** — NewPipeExtractor (Java) native modül | Olgun, Android'de savaşta test edilmiş | PC gerekmez, en sağlam çıkarım; **Android'de A'nın doğal yedeği** | Kotlin/Java köprüsü yazmak gerek |
| **C** | **PC köprüsü** — masaüstü Resonance küçük bir HTTP sunucu açar, telefon ondan çalar/indirir (LAN veya Tailscale) | Mevcut yt-dlp bilgisi %100 yeniden kullanılır | En hızlı yol, tüm tuzaklar zaten çözülmüş | **PC açık olmalı** → dışarıda çalışmaz (indirilmişler hariç) |
| **D** | **YouTube IFrame** gizli webview | ToS'a uygun tek yol | — | Mobilde arka planda çalmaz, gizlemek zaten ToS ihlali → **kullanma** |

### 2.2 Önerilen: **A, C'ye düşerek** (hibrit)

- **Ana yol A**: telefon `youtubei.js` ile stream URL'i çıkarır → track-player çalar.
  (Android'de B, A'nın birebir yedeği — iOS kısıtı olmadığı için native modül serbest.)
- **Yedek C**: A çıkaramazsa (imza değişikliği, throttle) ve PC erişilebilirse (Tailscale/LAN),
  masaüstünden çek. PC yoksa hata → sıradakine geç (masaüstündeki davranışın aynısı).
- **B'ye geçiş kriteri**: Faz 0 spike'ında A çalışmazsa doğrudan B'ye geç, A ile uğraşma.

Bu hibrit, masaüstünün **"önce çerezsiz dene, olmazsa alternatif yol"** felsefesinin aynısı.

### 2.3 Ses biçimi
Masaüstünün ADTS zorunluluğu (**rodio m4a'da panikliyor** — `CLAUDE.md` gotcha #1) **mobilde YOK**.
ExoPlayer m4a/webm'i sorunsuz çalar → **ffmpeg remux'a gerek yok**. `itag 140` (m4a, 128k) doğrudan çalınır.
> Sonuç: indirilen dosyalar iki platformda **farklı formatta** olabilir. Bu sorun değil —
> `cache` tablosu zaten senkronlanmıyor (§4).

---

## 3. Teknoloji seçimi: React Native (Expo prebuild)

**Neden Tauri 2 Android DEĞİL** (masaüstüyle aynı olmasına rağmen):
- Arka plan ses + MediaSession + bildirim kontrolleri Tauri'de **hazır gelmiyor** → Kotlin plugin yazacaksın.
- `rodio`/`cpal` Android'de çalışır ama arka planda OS webview'i öldürünce ses de ölür.
- yt-dlp gömülemediği için Rust tarafının asıl değeri (ytdlp.rs) zaten taşınamıyor.
- Net: Tauri'nin tek avantajı "aynı kabuk", ama mobilde en çok ihtiyacın olan şeyi vermiyor.

**Seçim:**
- **React Native + Expo (prebuild / dev client)** — Expo Go yetmez, native modül var.
- **`react-native-track-player`** — arka plan çalma, kilit ekranı/bildirim kontrolleri, kuyruk,
  offline dosya çalma. (Masaüstündeki `audio.rs` + medya tuşlarının karşılığı, bedava.)
- **`expo-sqlite`** — yerel SQLite (masaüstündeki `plugin-sql` karşılığı, **aynı şema**).
- **`expo-file-system`** — indirilen ses dosyaları.
- **zustand** — masaüstüyle aynı, store mantığı büyük ölçüde taşınabilir.
- **`youtubei.js`** — çıkarım (yol A).
- **NativeWind** (Tailwind for RN) — `src/index.css`'teki `@theme` token'ları **birebir**
  `tailwind.config` renklerine taşınır → aynı görsel dil.

---

## 4. Monorepo & kod paylaşımı

Hedef yapı:
```
MusicPlayer/
├─ src/                 # masaüstü React (mevcut, dokunma)
├─ src-tauri/           # masaüstü Rust (mevcut, dokunma)
├─ packages/core/       # ⭐ YENİ: platformdan bağımsız TS
│   ├─ types.ts             ← src/types.ts taşınır
│   ├─ karma.ts             ← src/lib/karma.ts (zaten saf)
│   ├─ share.ts             ← src/lib/share.ts (zaten saf)
│   ├─ recommender.ts       ← src/lib/recommender.ts (bağımlılıkları soyutlanarak)
│   ├─ sync.ts              ← YENİ: senkron motoru
│   └─ ports.ts             ← YENİ: platform arayüzleri
└─ mobile/              # ⭐ YENİ: React Native uygulaması
```

### 4.1 Paylaşılan (`packages/core`)
- `karma.ts` (decay, skor) — **zaten saf**, direkt taşınır.
- `share.ts` (RSNC1 kodu) — **zaten saf**, direkt taşınır.
- `types.ts` — direkt taşınır.
- `recommender.ts` — **soyutlanması gerek.** Şu an 3 yere bağlı:
  `@tauri-apps/api/core` (invoke → arama), `./db` (getDb), `../store/useSettingsStore`.
  Çözüm — `ports.ts`:
  ```ts
  export interface Ports {
    query<T>(sql: string, params?: unknown[]): Promise<T[]>;
    search(q: string, limit: number): Promise<Track[]>;
    getSettings(): { /* öneri için gereken ayarlar */ };
  }
  ```
  `recommender.ts` `Ports` alır; masaüstü Tauri implementasyonunu, mobil kendi
  implementasyonunu (expo-sqlite + youtubei.js) geçirir.
  > **Bu refactor masaüstünü bozmamalı.** Masaüstü tarafında `src/lib/recommender.ts`
  > ince bir sarmalayıcıya (`core`'u Tauri port'larıyla çağıran) dönüşür. `npm run build`
  > + gerçek .app testi ile doğrula.
- `sync.ts` — iki platform da aynı motoru kullanır.

### 4.2 Paylaşılmayan
- **Arayüz** (DOM ≠ RN). Tasarım dili paylaşılır, kod paylaşılmaz.
- **Ses katmanı** (rodio ≠ track-player).
- **Çıkarım** (yt-dlp ≠ youtubei.js).
- `usePlayerStore` — mantığı (kuyruk, `TARGET_QUEUE_AHEAD`, `spreadByArtist`, stale-token guard,
  `songCore` oturum belleği) **fikir olarak** taşınır ama track-player kuyruğuna göre yeniden yazılır.
  Masaüstündeki yarış-koşulu dersleri (`CLAUDE.md` gotcha #6–#10) **aynen geçerli** — tekrar yaşama.

---

## 5. Veri modeli: senkron şeması — ✅ ARTIK VAR (v1.3.0)

**Bu bölüm planlama değil, uygulanmış durum.** Masaüstünde **migration v5**
(`src-tauri/src/lib.rs`) senkron şemasını kurdu; mobil **birebir aynı şemayı**
kullanmalı, yeniden tasarlama:

- `playlists`, `playlist_tracks`, `tracks` → `updated_at` (+ ilk ikisinde `deleted`)
- `votes`, `play_history`, `recommendation_history` → `uid`, `device_id`, `updated_at`
  (+ `votes`'ta `deleted`)
- `sync_state(table_name, last_pulled TEXT, last_pushed INTEGER)`

Tam SQL için `lib.rs` migration v5'e, sunucu tarafı için
`docs/supabase-schema.sql`'e bak. Protokolün tamamı: **`docs/SYNC.md`**.

**Mobilde tekrar düşmemesi gereken tuzaklar** (masaüstünde çözüldü):
- `last_pulled` **sunucu zamanıdır (TEXT/ISO)**, cihaz zamanı değil — cihaz saatleri
  birbirini tutmaz, cihaz saatiyle pencere kurulursa satırlar sonsuza dek atlanır.
- Silme = **tombstone**; her okuma `deleted = 0` filtrelemeli.
- `tracks`'e `INSERT OR REPLACE` YAPMA (`CLAUDE.md` gotcha #12) → CASCADE uçurur.
  `ON CONFLICT(id) DO UPDATE` kullan.
- Eski satırların `updated_at`'i migration'da mevcut zaman damgalarından doldurulur
  (0 kalırsa hepsi "çok eski" sayılıp uzaktakine yenilirdi).

### Ne senkronlanır / ne senkronlanmaz
| Senkron ✅ | Senkron ❌ |
| --- | --- |
| `playlists`, `playlist_tracks` (oy dahil) | `cache` — ses dosyaları, cihaz-yerel (her cihaz kendi indirir) |
| `tracks` (metadata) | Gizli anahtarlar (Spotify client secret, çerez tarayıcısı) |
| `votes` (tombstone'lu) | `settings` — **tamamı** (içinde `resumeState`, cihaz kimliği, ses seviyesi var) |
| `play_history` (öneri motorunu cihazlar arası eğitir) | |
| `recommendation_history` (telefonda göreni PC'de tekrar görme) | |

---

## 5.1 Mobilin HAZIR bulacağı katmanlar (v1.3.0 → v1.6.0)

Masaüstünde çalışan ve mobilde **yeniden yazılmaması gereken** parçalar:

| Katman | Dosya | Mobil için not |
| --- | --- | --- |
| Senkron motoru | `src/lib/sync/engine.ts` | Saf TS + SQL; `packages/core`'a taşınır. Tek platform bağımlılığı DB adaptörü. |
| Sunucu şeması | `docs/supabase-schema.sql` | Aynen kullanılır; mobil yeni tablo EKLEMEZ. |
| Öneri motoru | `src/lib/recommender.ts` | `invoke()` çağrıları `Ports` arkasına alınmalı (search/radio/genre_pool). |
| Tür/ruh hali filtreleri | `src/lib/filters.ts` | Saf veri + string; olduğu gibi taşınır. |
| Oturum modu | `src/lib/mood.ts` | Saf TS, bağımlılıksız. |
| Zaman-bağlamlı zevk | `src/lib/taste.ts` | Saf TS + tek SQL sorgusu. |
| Öneri kabul oranı | `src/lib/acceptance.ts` | Saf TS + tek SQL. İki senkron tablodan türer → mobil hiçbir şey eklemeden aynı öğrenmeyi devralır. |
| **Çapraz cihaz devam** | `src/lib/nowPlaying.ts` + `now_playing` tablosu | ⭐ Mobilin en görünür kazancı: PC'de bırak, telefonda devam et. Şema HAZIR. |

**Mobilde platforma özel kalan tek şey SES**: yt-dlp gömülemez (§2).
`music_radio` / `music_genre_pool` / `search_youtube` şu an Rust'ta yt-dlp
sarmalayıcısı; mobilde bunların `youtubei.js` karşılığı yazılmalı ve aynı
`Track` şeklini döndürmelidir. Öneri motoru bu üç fonksiyonun ARKASINI bilmez.

## 6. Senkron protokolü — ✅ uygulandı

Detay: `docs/SYNC.md`. Motor masaüstünde `src/lib/sync/engine.ts`'te çalışıyor;
mobile taşınırken `packages/core`'a çıkarılacak (§4).

- **Local-first**: her cihaz kendi SQLite'ında çalışır, offline tam çalışır.
- **Supabase** (Postgres + Auth + RLS), sunucu kodu yok. RLS: `user_id = auth.uid()`.
- **Delta sync**: push (yerel `updated_at > last_pushed`) → pull (bulut
  `synced_at > last_pulled`) → LWW merge.
- **Çakışma**: satır başına **last-write-wins** (`updated_at`); olay günlükleri
  `uid` ile idempotent upsert.
- **Canlı**: Supabase Realtime aboneliği + periyodik (5 dk) + odak yedeği.
- **Mobil özel iş**: OS uygulamayı öldürebilir → bekleyen push'lar için `outbox`
  gerekebilir (masaüstünde gerekmedi).
- **Tetik**: açılış, değişiklikte (debounce ~3sn), periyodik (~5dk), foreground'a dönüş.
- **Mobil özel**: OS uygulamayı öldürebilir → push'u kuyruğa yaz (`outbox`), sonra tamamla.

---

## 7. Öneri motoru mobilde
- Aynı `packages/core/recommender.ts` çalışır → **aynı sonuçlar**, `Ports.search` mobilde
  `youtubei.js` araması olur.
- **Ağır kısım aramalar**: masaüstünde 3'erli paralel; mobilde de aynı (daha fazlası throttle).
- `TARGET_QUEUE_AHEAD = 20` mobilde **fazla** olabilir (pil + veri). **Öneri: 8–10**, ve
  "sadece Wi-Fi'da önden indir" ayarı.
- `songCore` / `excludeCores` mantığı aynen geçerli (gotcha: `excludeIds` tek başına yetmez).

---

## 8. Aşamalar

**Faz 0 — Spike (en önemli, 1 oturum).** Sadece ses yolunu doğrula. Boş bir RN projesinde:
`youtubei.js` ile bir video id'sinden stream URL çıkar → `react-native-track-player` ile çal →
uygulamayı arka plana al, çalmaya devam ediyor mu? **Çalışmıyorsa yol B'ye (NewPipeExtractor) geç.**
Bu faz bitmeden başka hiçbir şey yazma.

**Faz 1 — `packages/core` çıkarımı.** karma/share/types taşı, `recommender.ts`'i `Ports` ile soyutla,
masaüstünü sarmalayıcıya bağla. **Masaüstü hâlâ bire bir çalışmalı** (`npm run build` + .app testi).
Bu faz mobil kodu içermez; masaüstü sohbetinde de yapılabilir.

**Faz 2 — Mobil iskelet.** Expo prebuild, expo-sqlite + **aynı migration'lar** (v1–v4), NativeWind +
`@theme` token'ları, ekranlar: Şu An, Kütüphane, Playlist, Ara. Çalma: track-player + Faz 0'daki yol.
Offline indirme + LRU kota.

**Faz 3 — Senkron.** Supabase projesi + Auth + RLS. Migration **v5** (§5) → hem masaüstü hem mobil.
`packages/core/sync.ts`. Önce masaüstü↔Supabase, sonra mobil. **İlk testte mutlaka DB yedeği al**
(masaüstünde açılışta otomatik yedek var — `backups/`).

**Faz 4 — Keşfet + öneri.** `startDiscovery` mobil karşılığı, `TARGET_QUEUE_AHEAD` düşürülmüş.

**Faz 5 — Cila.** Kilit ekranı görseli, bildirim kontrolleri, kulaklık tuşları (track-player hazır verir),
ambiyans ekranı, veri/pil ayarları.

---

## 9. Riskler (dürüst)
1. **Çıkarım kırılganlığı (yüksek).** YouTube imza/throttle değiştirince `youtubei.js` güncellenene
   kadar çalmaz. Masaüstünde `update_ytdlp` ile çözülüyor; mobilde kütüphane güncellemesi =
   **yeni build**. → Yedek yol C (PC köprüsü) bu yüzden değerli.
2. **Faz 0 başarısızlığı (orta).** youtubei.js + Hermes imza çözme sorunu bilinen bir konu.
   Plan B (NewPipeExtractor native modül) hazır ama Kotlin iş yükü ekler.
3. **Senkron veri kaybı (orta ama pahalı).** Geçmişte iki-instance yarışından veri kaybı yaşandı.
   Senkron bunu **çok daha kolay** hale getirir. → Faz 3'te önce salt-okunur pull ile test, yedekle.
4. **Pil/veri (düşük).** Prefetch agresifliği ayarlanabilir olmalı.

## 10. Bilerek yapılmayanlar
- **iOS** — kullanıcının kararı (Android kullanıyor; iOS'un imza/mağaza yükü değmez).
- Web sürümü (`docs/SYNC.md`'de var, şimdilik kapsam dışı).
- Mağaza dağıtımı (ToS).
- Masaüstünün ses mimarisini mobile uydurmak (ADTS zorunluluğu mobilde anlamsız).
