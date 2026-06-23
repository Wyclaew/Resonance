# Resonance — Hesap & Senkron Planı (mobil + web)

Amaç: Masaüstü (var), **mobil** (Tauri/Android) ve **web** sürümlerini bir
**hesap** üzerinden bağlamak; çalma listeleri, oylar/karma ve ayarlar tüm
cihazlarda takip etsin. (Playlist **paylaşımı** zaten kod ile çalışıyor — bu ondan
ayrı: kişinin kendi verisinin cihazlar arası senkronu.)

## ⚠️ En kritik gerçek: ses katmanı platforma göre değişir

| Platform | Ses nasıl çalar? |
| --- | --- |
| **Masaüstü** (şimdiki) | yt-dlp ile m4a indir → ADTS remux → Rust/rodio çalar |
| **Mobil** (Tauri/Android) | yt-dlp benzeri cihazda çalışabilir (Android'de mümkün; iOS çok zor — sideload) |
| **Web** (tarayıcı) | **yt-dlp ÇALIŞAMAZ** (tarayıcı sandbox). Gerçekçi yol: **YouTube IFrame Player API** — video id ile çalar, resmi ve **ToS'a uygun** (yt-dlp'nin aksine). Video gizlenip "ses" gibi kullanılır. |

**Sonuç:** Ortak/paylaşılan katman = **hesap + veri senkronu** (playlist, oy, ayar).
**Ses katmanı platforma özel** kalır. Web aslında daha *temiz* (iframe player yasal).

## Stack: Supabase (kişisel kullanımda ücretsiz katman fazlasıyla yeter)

- **Auth**: e-posta/şifre veya Google/Apple ile giriş.
- **Postgres**: senkronlanan tabloların bulut aynası + **RLS** (her kullanıcı yalnız kendi verisini görür).
- **Realtime** (opsiyonel): açık cihazlar arasında anlık senkron.
- Sunucu kodu YOK — her uygulama Supabase istemcisiyle doğrudan konuşur.

## Ne senkronlanır / ne senkronlanmaz

- **Senkron**: `playlists`, `playlist_tracks`, `votes` (olay günlüğü), `settings`
  (gizli olmayanlar), opsiyonel `play_history` (cihazlar arası öğrenme için).
- **Senkron DEĞİL**: ses önbelleği/indirmeler (çok büyük, cihaz-yerel; her cihaz
  kendi indirir), Spotify/çerez **gizli anahtarları** (cihaz-yerel kalır).

## Senkron modeli: local-first + delta sync

- Her cihaz **yerel SQLite**'ı tutar → çevrimdışı çalışır.
- Senkron motoru yereldeki değişiklikleri Supabase'e **push**, uzaktakileri **pull** edip birleştirir.
- Birleştirme: her satıra `updated_at` (epoch ms) + `deleted` (tombstone). Satır
  başına **last-write-wins** (updated_at'e göre). `votes` append-only → çakışma yok.
- Tetik: açılışta, değişiklikte (debounce), periyodik, Realtime push.

## Senkron için şema hazırlığı (sync kurarken yapılacak — şimdi değil)

1. `playlists`, `playlist_tracks`'e `updated_at` + `deleted` ekle.
2. `votes`/`playlist_tracks` kimliklerini cihazlar arası benzersiz yap (**UUID**;
   şu an votes autoincrement → bulut için UUID veya cihaz-namespace).
3. `user_id` (ya da Supabase RLS ile örtük).
4. Cihaz/kurulum kimliği (sync defteri için) — *bu turda eklendi*.

## Web uygulaması

- React arayüzü **yeniden kullanılır**. Değişenler:
  - Yerel ses katmanı → **YouTube IFrame Player**.
  - plugin-sql (yerel SQLite) → Supabase (veya IndexedDB + Supabase).
- Statik site olarak dağıt (Vercel/Netlify) + Supabase.

## Mobil (Tauri 2 / Android)

- React arayüzü yeniden kullanılır. Ses: Android'de yt-dlp benzeri çözüm araştırılır.
  iOS yalnız sideload + arka plan ses kısıtlı.

## Aşamalar

1. **Şimdi (bu tur)**: hafif altyapı — cihaz kimliği + Ayarlar'da "Hesap" bölümü
   (yer tutucu + bu planın özeti). Çalışan uygulamaya dokunmadan.
2. **Senkron**: Supabase projesi + Auth + sync motoru (şema migration: updated_at /
   tombstone / UUID). Masaüstü senkronu.
3. **Web**: iframe player + Supabase.
4. **Mobil**: Tauri Android.

## Gizlilik notu

Senkron açılana kadar her şey **tamamen yerel ve gizli** kalır. Senkron *opt-in*
olacak (kullanıcı giriş yapana kadar bulut yok). Ses hep cihazda; buluta yalnızca
metadata (liste/oy/ayar) gider.
