# Resonance — Hesap & Senkron Planı

Amaç: Masaüstü (var, v1.1.0), **mobil** (`docs/MOBILE.md`) ve ileride web sürümlerini bir
**hesap** üzerinden bağlamak; çalma listeleri, oylar/karma, dinleme geçmişi ve ayarlar tüm
cihazlarda takip etsin. (Playlist **paylaşımı** zaten `RSNC1:` kodu ile çalışıyor — bu ondan
ayrı: kişinin **kendi** verisinin cihazlar arası senkronu.)

**Durum: planlama.** Hiçbir parçası uygulanmadı; şu an her şey tamamen yerel.
Uygulanan tek hazırlık: cihaz kimliği (`src/lib/device.ts`).

---

## ⚠️ En kritik gerçek: ses katmanı platforma göre değişir

| Platform | Ses nasıl çalar? |
| --- | --- |
| **Masaüstü** (var) | yt-dlp → m4a indir → ADTS remux → Rust/rodio çalar |
| **Mobil** (planlanan) | Cihazda `youtubei.js` çıkarımı → ExoPlayer/AVPlayer. **yt-dlp gömülemez.** Alternatifler: `docs/MOBILE.md` §2 |
| **Web** (kapsam dışı) | **yt-dlp ÇALIŞAMAZ** (tarayıcı sandbox). Tek gerçekçi yol: **YouTube IFrame Player API** — resmi ve ToS'a uygun |

**Sonuç:** Ortak katman = **hesap + veri senkronu** (playlist, oy, geçmiş, ayar).
**Ses katmanı platforma özel** kalır ve senkronlanmaz.

---

## Stack: Supabase

- **Auth**: e-posta/şifre veya Google/Apple.
- **Postgres**: senkronlanan tabloların bulut aynası + **RLS** (`user_id = auth.uid()`).
- **Realtime** (opsiyonel): açık cihazlar arasında anlık senkron.
- **Sunucu kodu YOK** — her uygulama Supabase istemcisiyle doğrudan konuşur.
- Kişisel kullanımda ücretsiz katman fazlasıyla yeter (veri = birkaç MB metin).

## Ne senkronlanır / ne senkronlanmaz

| Senkron ✅ | Senkron ❌ |
| --- | --- |
| `playlists`, `playlist_tracks` (güncel oy dahil) | `cache` — ses dosyaları; çok büyük, cihaz-yerel (her cihaz kendi indirir) |
| `tracks` (metadata) | Gizli anahtarlar: Spotify client_id/secret, çerez tarayıcısı seçimi |
| `votes` (append-only olay günlüğü) | Cihaza özel ayarlar: ses seviyesi, ambiyans süresi, autostart, arka plan FPS modu |
| `play_history` (öneri motorunu cihazlar arası eğitir) | |
| `recommendation_history` (telefonda göreni PC'de tekrar görme) | |
| Genel ayarlar (tema, öneri ağırlıkları) | |

## Senkron modeli: local-first + delta sync

- Her cihaz **yerel SQLite**'ını tutar → **çevrimdışı tam çalışır**.
- Senkron motoru yereldeki değişiklikleri Supabase'e **push**, uzaktakileri **pull** edip birleştirir.
- **Birleştirme**: her satırda `updated_at` (epoch ms) + `deleted` (tombstone).
  Satır başına **last-write-wins**. `votes` / `play_history` append-only → **çakışma yok**,
  `uid` ile idempotent upsert.
- **Tetik**: açılışta, değişiklikte (debounce ~3sn), periyodik (~5dk), foreground'a dönüşte,
  (opsiyonel) Realtime push.
- **Mobil özel**: OS uygulamayı öldürebilir → bekleyen push'ları `outbox`'a yaz, sonra tamamla.

## Şema hazırlığı — migration v5 (senkron kurulurken)

Mevcut şema (`src-tauri/src/lib.rs`, v1–v4) senkron için hazır **değil**:

```sql
-- 1) Satır bazlı LWW için zaman damgası + tombstone
ALTER TABLE playlists       ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playlists       ADD COLUMN deleted    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playlist_tracks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playlist_tracks ADD COLUMN deleted    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks          ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

-- Eski satırlar 0 kalırsa ilk senkronda "eski" sayılıp uzaktakine ezilir → doldur:
UPDATE playlists       SET updated_at = created_at WHERE updated_at = 0;
UPDATE playlist_tracks SET updated_at = added_at   WHERE updated_at = 0;
UPDATE tracks          SET updated_at = added_at   WHERE updated_at = 0;

-- 2) Cihazlar arası benzersiz kimlik
--    (votes/play_history AUTOINCREMENT → iki cihaz aynı id'yi üretir, ÇAKIŞIR)
ALTER TABLE votes        ADD COLUMN uid       TEXT;   -- "<device_id>:<local_id>" veya UUID
ALTER TABLE votes        ADD COLUMN device_id TEXT;
ALTER TABLE play_history ADD COLUMN uid       TEXT;
ALTER TABLE play_history ADD COLUMN device_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_uid ON votes(uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hist_uid  ON play_history(uid);

-- 3) Senkron defteri
CREATE TABLE IF NOT EXISTS sync_state (
  table_name  TEXT PRIMARY KEY,
  last_pulled INTEGER NOT NULL DEFAULT 0,
  last_pushed INTEGER NOT NULL DEFAULT 0
);
```
- `user_id` gerekmez — Supabase RLS ile örtük.
- Cihaz kimliği **zaten var**: `src/lib/device.ts` (settings'te saklı).
- **⛔ DİKKAT** (`CLAUDE.md` gotcha #12): senkron `tracks`'e yazarken **`INSERT OR REPLACE` KULLANMA** →
  satırı silip ekler, `ON DELETE CASCADE` şarkıyı TÜM listelerden uçurur.
  `ensureTrack` mantığını (`ON CONFLICT(id) DO UPDATE`) kullan.

## Kod paylaşımı

Senkron motoru `packages/core/sync.ts`'te yaşar (bkz. `docs/MOBILE.md` §4) — masaüstü ve
mobil aynı motoru kullanır, platform farkları `Ports` arayüzüyle soyutlanır.

## Aşamalar

1. **Yapıldı**: cihaz kimliği (`src/lib/device.ts`).
2. **`packages/core` çıkarımı** (MOBILE.md Faz 1) — sync.ts'in yaşayacağı yer.
3. **Senkron**: Supabase projesi + Auth + migration v5 + sync motoru. **Önce masaüstü.**
4. **Mobil senkron** (MOBILE.md Faz 3).
5. **Web** (opsiyonel, kapsam dışı): iframe player + Supabase.

## ⚠️ Veri kaybı riski

Geçmişte iki-instance yarışından şüphelenilen bir veri kaybı yaşandı; tek-örnek koruması ve
açılışta otomatik yedek (`backups/`, son 12) o yüzden var. **Senkron bu riski artırır** —
uzaktan gelen bir tombstone yereli silebilir. Kurallar:
- İlk aşamada **salt-okunur pull** ile test et, yazmayı açma.
- Test öncesi elle yedek al (`backup_db`).
- Silme her zaman tombstone; **hard delete yok**.

## Gizlilik notu

Senkron açılana kadar her şey **tamamen yerel ve gizli** kalır. Senkron **opt-in** olacak
(giriş yapılana kadar bulut yok). Ses hep cihazda; buluta yalnızca metadata gider.
