# Resonance Mobil — Detaylı Plan (ayrı sohbette uygulanacak)

Bu dosya, mobil uygulamayı **sıfırdan başka bir sohbette** yapacak olan için yazıldı.
Masaüstünün mimarisi ve tuzakları için önce **`CLAUDE.md`**'yi oku; senkron protokolü
`docs/SYNC.md`'de. Bu doküman "mobil nasıl yapılır"ı anlatır.

**Amaç:** Eren'in kendi kullanımı için mobil Resonance. Masaüstüyle **senkron**
(playlist, oy/karma, dinleme geçmişi, ayarlar). Ses yine YouTube'dan.
**Kişisel kullanım, mağazaya çıkmayacak, repo private.**

---

## 0. Önce kararlaştırılacak iki şey (Faz 0'da netleşmeli)

1. **Telefon Android mi iPhone mı?** Bu plan **Android-öncelikli**. iOS gerçeği aşağıda
   (§2.4) — App Store'a çıkamaz, sideload + 7 günde bir yeniden imzalama gerekir.
2. **Ses yolu** (§2) — projenin en riskli kararı. Faz 0'daki spike bunu doğrulamadan
   arayüz kodu yazmaya başlama.

---

## 1. Kısıtlar (masaüstünden farklı olan her şey)

| Konu | Masaüstü (mevcut) | Mobil (gerçek) |
| --- | --- | --- |
| Çıkarım aracı | `yt-dlp` (Python binary) | **Çalışmaz** — Android'de app içine gömülemez (Termux ayrı bir şey) |
| Ses motoru | Rust `rodio` + symphonia | Platform oynatıcı (ExoPlayer/AVPlayer) — arka plan + kilit ekranı için ŞART |
| Arka plan çalma | Bedava (masaüstü) | **Foreground Service + MediaSession** (Android) / audio background mode (iOS) gerekir |
| Depolama | Sınırsız sayılır | Sınırlı → indirme kotası + LRU temizlik gerekir |
| Ağ | Sabit | Mobil veri / offline → **offline-first ŞART**, indirme kotası mobil veride kapalı |
| Süreç ömrü | Uygulama açık kalır | OS istediğinde öldürür → durumu sık kaydet |

---

## 2. En kritik karar: ses nasıl gelecek?

### 2.1 Seçenekler (dürüst karşılaştırma)

| # | Yol | Nasıl | Artı | Eksi |
| --- | --- | --- | --- | --- |
| **A** | **Cihazda çıkarım (JS)** — `youtubei.js` (YouTube.js, NewPipe muadili, saf TS) ile stream URL'i al, `react-native-track-player` (ExoPlayer) ile çal | Telefon kendi başına yeter | PC gerekmez, tam bağımsız, arka plan/kilit ekranı hazır gelir | RN'de **imza çözme (signature decipher)** JS-motoru gerektirir; Hermes'te tökezleyebilir. **DOĞRULANMADI** → Faz 0 spike şart |
| **B** | **Cihazda çıkarım (native)** — NewPipeExtractor (Java) native modül | Olgun, Android'de savaşta test edilmiş | PC gerekmez, en sağlam çıkarım | Kotlin/Java köprüsü yazmak gerek; iOS'ta yok |
| **C** | **PC köprüsü** — masaüstü Resonance küçük bir HTTP sunucu açar, telefon ondan çalar/indirir (LAN veya Tailscale) | Mevcut yt-dlp bilgisi %100 yeniden kullanılır | En hızlı yol, tüm tuzaklar zaten çözülmüş | **PC açık olmalı** → dışarıda çalışmaz (indirilmişler hariç) |
| **D** | **YouTube IFrame** gizli webview | ToS'a uygun tek yol | — | Mobilde arka planda çalmaz, gizlemek zaten ToS ihlali → **kullanma** |

### 2.2 Önerilen: **A, C'ye düşerek** (hibrit)

- **Ana yol A**: telefon `youtubei.js` ile stream URL'i çıkarır → track-player çalar.
- **Yedek C**: A çıkaramazsa (imza değişikliği, throttle) ve PC erişilebilirse (Tailscale/LAN),
  masaüstünden çek. PC yoksa hata → sıradakine geç (masaüstündeki davranışın aynısı).
- **B'ye geçiş kriteri**: Faz 0 spike'ında A çalışmazsa doğrudan B'ye geç, A ile uğraşma.

Bu hibrit, masaüstünün **"önce çerezsiz dene, olmazsa alternatif yol"** felsefesinin aynısı.

### 2.3 Ses biçimi
Masaüstünün ADTS zorunluluğu (**rodio m4a'da panikliyor** — `CLAUDE.md` gotcha #1) **mobilde YOK**.
ExoPlayer m4a/webm'i sorunsuz çalar → **ffmpeg remux'a gerek yok**. `itag 140` (m4a, 128k) doğrudan çalınır.
> Sonuç: indirilen dosyalar iki platformda **farklı formatta** olabilir. Bu sorun değil —
> `cache` tablosu zaten senkronlanmıyor (§4).

### 2.4 iOS gerçeği (yumuşatmadan)
- App Store'a **çıkamaz** (YouTube'dan ses çıkarma → reddedilir).
- Sideload: ücretsiz Apple hesabıyla **7 günde bir yeniden imzalama**; ücretli hesap (99$/yıl) ile 1 yıl.
- AltStore/SideStore otomatik yeniler ama kurulum zahmetli.
- **Karar:** Android varsa oradan başla. iPhone ise bunu baştan kabul et.

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

## 5. Veri modeli: senkron için şema değişiklikleri

Mevcut şema (`src-tauri/src/lib.rs`, migration v1–v4) senkron için hazır **değil**. Gereken **migration v5**
(masaüstü + mobil aynı SQL'i kullanır):

```sql
-- 1) Satır bazlı LWW için zaman damgası + tombstone
ALTER TABLE playlists       ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playlists       ADD COLUMN deleted    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playlist_tracks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playlist_tracks ADD COLUMN deleted    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks          ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

-- 2) Cihazlar arası benzersiz kimlik (votes/play_history AUTOINCREMENT → çakışır!)
ALTER TABLE votes        ADD COLUMN uid       TEXT;  -- "<device_id>:<local_id>" veya UUID
ALTER TABLE play_history ADD COLUMN uid       TEXT;
ALTER TABLE votes        ADD COLUMN device_id TEXT;
ALTER TABLE play_history ADD COLUMN device_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_uid ON votes(uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hist_uid  ON play_history(uid);

-- 3) Senkron defteri
CREATE TABLE IF NOT EXISTS sync_state (
  table_name  TEXT PRIMARY KEY,
  last_pulled INTEGER NOT NULL DEFAULT 0,  -- son çekilen updated_at
  last_pushed INTEGER NOT NULL DEFAULT 0
);
```
- Cihaz kimliği **zaten var**: `src/lib/device.ts` (settings'te saklı) → `device_id` oradan.
- **DİKKAT** (`CLAUDE.md` gotcha #12): senkron yazarken `tracks`'e `INSERT OR REPLACE` yapma →
  CASCADE her şeyi uçurur. `ensureTrack` mantığını (`ON CONFLICT(id) DO UPDATE`) kullan.
- Migration v5 masaüstüne eklendiğinde **eski satırların `updated_at`'i 0** olur → ilk senkronda
  hepsi "eski" sayılıp uzaktakine yenilir. **Doğru davranış:** migration içinde mevcut satırları
  `updated_at = added_at/created_at` ile doldur (`UPDATE ... SET updated_at = created_at`).

### Ne senkronlanır / ne senkronlanmaz
| Senkron ✅ | Senkron ❌ |
| --- | --- |
| `playlists`, `playlist_tracks` (oy dahil) | `cache` — ses dosyaları, cihaz-yerel (her cihaz kendi indirir) |
| `tracks` (metadata) | Gizli anahtarlar (Spotify client secret, çerez tarayıcısı) |
| `votes` (append-only olay günlüğü) | Cihaza özel ayarlar (ses seviyesi, ambiyans süresi, autostart) |
| `play_history` (öneri motorunu cihazlar arası eğitir) | `recommendation_history` — **tartışmalı**: senkronlanırsa telefonda gördüğünü PC'de tekrar görmezsin (iyi), ama trafiği artırır. **Öneri: senkronla** (küçük tablo, 45 gün) |
| Genel ayarlar (tema, öneri ağırlıkları) | |

---

## 6. Senkron protokolü

Detay: `docs/SYNC.md`. Özet:
- **Local-first**: her cihaz kendi SQLite'ında çalışır, offline tam çalışır.
- **Supabase** (Postgres + Auth + RLS). Kişisel kullanımda ücretsiz katman fazlasıyla yeter.
  Sunucu kodu yok; her istemci Supabase client'ıyla konuşur. RLS: `user_id = auth.uid()`.
- **Delta sync**: `pull(since=last_pulled)` → merge → `push(değişenler)`.
- **Çakışma**: satır başına **last-write-wins** (`updated_at`). `votes`/`play_history`
  **append-only** → çakışma yok, `uid` ile idempotent upsert.
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
3. **iOS (yüksek, eğer iPhone'sa).** 7 günlük imza döngüsü.
4. **Senkron veri kaybı (orta ama pahalı).** Geçmişte iki-instance yarışından veri kaybı yaşandı.
   Senkron bunu **çok daha kolay** hale getirir. → Faz 3'te önce salt-okunur pull ile test, yedekle.
5. **Pil/veri (düşük).** Prefetch agresifliği ayarlanabilir olmalı.

## 10. Bilerek yapılmayanlar
- Web sürümü (`docs/SYNC.md`'de var, şimdilik kapsam dışı).
- Mağaza dağıtımı (ToS).
- Masaüstünün ses mimarisini mobile uydurmak (ADTS zorunluluğu mobilde anlamsız).
