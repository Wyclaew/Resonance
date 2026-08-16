# Resonance — Hesap & Senkron

Kişinin **kendi** verisinin cihazlar arası senkronu: çalma listeleri, oylar/karma,
dinleme geçmişi ve öneri geçmişi. (Playlist **paylaşımı** ayrı bir özellik: `RSNC1:` kodu.)

**Durum: UYGULANDI (v1.3.0) — masaüstü (Mac + Windows).** Mobil için aynı şema ve
aynı motor kullanılacak (`docs/MOBILE.md`).

---

## Kurulum (tek seferlik)

1. **Supabase projesi** (ücretsiz katman yeter).
2. **Şema**: Supabase paneli → SQL Editor → `docs/supabase-schema.sql` içeriğini
   yapıştır → Run. (Tekrar çalıştırmak güvenli.)
3. **Bağlantı bilgileri**: `src/lib/sync/config.ts` içine
   Project URL + **anon** (public) anahtarı yaz.
   - anon key gizli değildir; veriyi **RLS** korur (`user_id = auth.uid()`).
   - ⛔ `service_role` anahtarı ASLA kullanılmaz — RLS'i bypass eder.
   - Boş bırakılırsa senkron kapalıdır, uygulama %100 yerel çalışır.
4. Uygulamada **Ayarlar → Hesap & Senkron** → e-posta/şifre ile kayıt ol / giriş yap.
   - Supabase'de e-posta onayı açıksa ilk kayıtta gelen maili onayla.
5. **İlk senkron yönünü seç** (aşağıda).

### ⚠️ Uygulama güncellenince ŞEMAYI DA GÜNCELLE

Yeni sürüm senkrona tablo/sütun eklemiş olabilir (ör. v1.6.0 `now_playing`).
Supabase'de o tablo yoksa PostgREST **"Could not find the table … in the schema
cache"** der. Çözüm: `docs/supabase-schema.sql`'i SQL Editor'de YENİDEN çalıştır
(idempotent). Denetim: `python3 scripts/sync-schema-check.py` motorun beklediği
sütunlarla şema dosyasını karşılaştırır.

v1.6.3'ten beri tek tablonun hatası turu iptal ETMEZ — diğer tablolar
senkronlanmaya devam eder ve arayüz ne yapman gerektiğini yazar.

## İlk senkron — yön seçimi

İki cihazda da veri varsa çakışmayı kullanıcı çözer. Giriş yapınca sihirbaz çıkar:

| Seçenek | Ne yapar |
| --- | --- |
| **Bu cihaz kaynak** | Yereldeki her şey buluta yüklenir (`firstSyncPushAll`). |
| **Buluttan al** | Yereldeki playlist/oy/geçmiş **silinir**, bulut kopyası gelir (`firstSyncPullReplace`). |

Her iki modda da **önce otomatik yedek** alınır (`backup_db`).

**⚠️ "Buluttan al" `tracks` tablosunu BİLEREK silmez.** `cache` tablosu tracks'e
`ON DELETE CASCADE` ile bağlıdır → tracks silinseydi **indirilmiş dosya kayıtları da
uçardı** ve uygulama diskteki sesleri "indirilmemiş" sanardı. tracks yalnızca
metadata ve anahtarı YouTube id'si olduğu için birleşmesi zararsızdır (kopya oluşmaz).

Bu ilk seçimden sonra ikisi de **normal iki yönlü** çalışır: hangi cihazda
değişiklik yaparsan diğerine gider.

---

## Mimari

```
Cihaz A (SQLite)  ──push──▶  Supabase (Postgres + RLS)  ──pull──▶  Cihaz B (SQLite)
      ▲                            │ realtime                          │
      └────────────────────────────┴──────────────────────────────────-┘
```

- **Local-first**: her cihaz kendi SQLite'ını kullanır → **çevrimdışı tam çalışır**.
- **Delta sync**: yalnız değişen satırlar taşınır.
- **Sunucu kodu yok**: uygulama doğrudan Supabase ile konuşur.

### ⭐ İki ayrı zaman damgası — bu ayrım kritik

| Alan | Kimin saati | Ne için |
| --- | --- | --- |
| `updated_at` (epoch ms) | **Cihaz** | Yalnız **çakışma çözümü** (last-write-wins) |
| `synced_at` (timestamptz) | **Sunucu** (Postgres trigger) | Yalnız **teslimat penceresi** (pull watermark) |

**Neden:** iki cihazın saati birbirini tutmaz. Teslimat penceresi cihaz saatine
bağlansaydı, saati geri kalan cihaz diğerinin satırlarını "zaten görmüşüm" sanıp
**sonsuza dek atlardı**. Sunucu saati tek ve ortaktır.

### ⭐ Silme = tombstone

`deleted = 1` yazılır, satır **silinmez**. Hard delete diğer cihaza "böyle bir satır
hiç yoktu" gibi görünür ve silinen satır geri gelir.

**Sonuç: HER OKUMA `deleted = 0` filtrelemek ZORUNDA.** (`playlists.ts`,
`recommender.ts`, dışa aktarma — hepsi filtreliyor.)

### ⭐ `uid` — olay günlükleri için cihazdan bağımsız kimlik

`votes` / `play_history` / `recommendation_history` `AUTOINCREMENT id` kullanır →
iki cihaz **kaçınılmaz olarak** aynı id'yi üretir (ikisi de 1, 2, 3… diye sayar).
Buluta o id ile yazılsa cihazlar birbirinin oylarını ezerdi. `uid` (UUID) upsert
anahtarıdır → aynı satır iki kez gelse bile tek kayıt olur (idempotent).

### Dosyalar

| Dosya | İş |
| --- | --- |
| `src/lib/sync/config.ts` | URL + anon key (kullanıcı doldurur) |
| `src/lib/sync/client.ts` | Supabase istemcisi + auth (giriş/kayıt/çıkış) |
| `src/lib/sync/engine.ts` | push / pull / LWW merge / realtime / ilk-senkron modları |
| `src/components/SyncSettings.tsx` | Ayarlar → Hesap & Senkron arayüzü |
| `docs/supabase-schema.sql` | Sunucu şeması + RLS + realtime |
| `src-tauri/src/lib.rs` (migration v5) | Yerel şema: `updated_at`, `deleted`, `uid`, `sync_state` |

### Tetikleyiciler

- Açılış (oturum varsa), **realtime** olayı (diğer cihaz yazdığı an),
  yerel değişiklik (**3 sn debounce**, `notifyLocalChange()`),
  periyodik (**5 dk**), pencere odağı.
- Realtime kopabilir (uyku/ağ değişimi) → periyodik + odak yedek tetiklerdir.

## Ne senkronlanır / ne senkronlanmaz

| Senkron ✅ | Senkron ❌ |
| --- | --- |
| `tracks` (metadata) | `cache` — indirilen ses dosyaları (cihaz-yerel, yolu farklı) |
| `playlists`, `playlist_tracks` (oy dahil) | `settings` — **tamamı**; içinde `resumeState` (Keşfet kuyruğu), cihaz kimliği, ses seviyesi gibi cihaza özel şeyler var |
| `votes` (tombstone'lu) | Gizli anahtarlar (Spotify client id/secret, çerez tarayıcısı) |
| `play_history` | |
| `recommendation_history` | |

> **Neden öğrenme sinyalleri de senkronlanıyor:** `playlist_tracks` sanatçı
> yakınlığının ana kaynağı, `votes` + `play_history` zaman-bağlam profilini besliyor.
> Bunlar senkronlanmazsa cihazlar **farklı zevk öğrenir** ve öneriler tutarsız olur.
> (Ayrıntı: `CLAUDE.md` → Öneri motoru.)

**Tema/dil senkronlanmıyor** (bilinçli): `settings` tablosu bir bütün olarak
cihaza özel şeyler içeriyor; seçmeli senkron ileride eklenebilir.

## Güvenlik / gizlilik

- **RLS**: her satır `user_id = auth.uid()` ile kilitli. anon key herkese açık olsa
  bile başkasının verisi görünmez.
- Senkron **opt-in**: giriş yapılmadıkça hiçbir şey buluta gitmez.
- Ses dosyaları **asla** buluta gitmez — yalnız metadata.
- Bulutta **yabancı anahtar (FK) yok** (bilerek): parçası henüz yüklenmemiş bir
  `playlist_tracks` satırı FK'lı şemada push'u komple patlatırdı. Tutarlılık yerelde
  (SQLite) korunur; bulut yalnızca taşıyıcıdır.

## Veri kaybı riskine karşı

- İlk senkronun her iki modunda da **otomatik yedek**.
- Açılışta otomatik yedek zaten var (son 12).
- Silme her zaman tombstone → uzaktan gelen bir hata yereli kalıcı olarak uçuramaz.
- Pull sırasında bir satır hata verirse (tipik: ebeveyni gelmemiş FK), o tablonun
  su terazisi **o satırdan önceye sabitlenir** → satır kaybolmaz, sonraki turda
  yeniden denenir.

## Sırada

- **Mobil (Android)** — aynı şema + aynı motor mantığı (`docs/MOBILE.md`).
- Seçmeli ayar senkronu (tema/dil) — şu an kapsam dışı.
- Web (opsiyonel): iframe player + aynı Supabase.
