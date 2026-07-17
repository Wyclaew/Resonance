# Resonance

Hafif, karma tabanlı kişisel müzik oynatıcı. **Mac & Windows** (Android planlandı: `docs/MOBILE.md`).

- **Hafif:** Tauri 2 (Rust + sistem webview). Electron değil.
- **Kaynak:** YouTube (yt-dlp). Spotify / YouTube Music çalma listeleri link ile içe aktarılır
  (Spotify için **anahtar gerekmez**).
- **Karma:** Çalma listelerinde Reddit tarzı upvote/downvote — zaman decay'li skor.
- **Öğrenen öneri:** Hangi gün/saat neyi oyladığını, **gerçekte ne kadar dinlediğini** ve
  **çalma listelerine neleri eklediğini** öğrenen, hafif ve açıklanabilir bir algoritma.
  Beğendiğin tarzda **yeni sanatçılar** keşfeder; sevdiğin şarkılar doğru gün/saatte geri gelir.
- **Keşfet:** Playlist'siz, tamamen öneriyle ilerleyen sonsuz keşif modu (sıra hep önden dolu).
- **Tamamen yerel:** sunucu yok, hesap yok, veri cihazında.
- **Türkçe / İngilizce** arayüz, **koyu / açık** tema.

> Kişisel kullanım içindir. YouTube'dan ses çekmek YouTube ToS'una aykırı olabilir;
> depoyu özel (private) tutun.

## Geliştirme

```bash
npm install
npm run build                                  # frontend tip kontrolü
cd src-tauri && cargo check                    # Rust tip kontrolü
npm run tauri build -- --debug --bundles app   # yerel debug paketi
npm run tauri build                            # .dmg / .exe üret
```

Gereksinimler: Node, Rust. `yt-dlp` + `ffmpeg` sistemde varsa kullanılır (hızlı),
yoksa uygulamaya gömülü sidecar devreye girer.

> `npm run tauri dev` bazı ortamlarda GUI açamıyor — ayrıntı ve doğrulama akışı için `CLAUDE.md`.

## Dokümanlar

| Dosya | İçerik |
| --- | --- |
| `CLAUDE.md` | **Mimari, kritik kararlar, tuzaklar** — geliştirmeye başlamadan önce oku |
| `docs/MOBILE.md` | Mobil uygulama planı (ses katmanı seçenekleri, fazlar, riskler) |
| `docs/SYNC.md` | Cihazlar arası senkron planı (Supabase, şema değişiklikleri) |
| `docs/RELEASE.md` | Sürüm çıkarma / CI rehberi |

## Durum

**v1.2.0** — masaüstü olgun ve günlük kullanımda. M0–M8 tamamlandı; Mac'te sorunsuz,
Windows'ta bilinen tüm indirme/çalma sorunları çözüldü.

| Aşama | İçerik | Durum |
| --- | --- | --- |
| M0 | İskelet (Tauri + React + SQLite) | ✅ |
| M1 | Çekirdek oynatma (yt-dlp + Rust ses motoru) | ✅ |
| M2 | Kütüphane & çalma listeleri | ✅ |
| M3 | Karma (upvote/downvote + decay) | ✅ |
| M4 | Öğrenen öneri algoritması | ✅ |
| M5 | İçe aktarma (Spotify / YouTube Music) | ✅ |
| M6 | Detaylı ayarlar | ✅ |
| M7 | Ekstralar (sözler, sleep timer, medya tuşları, komut paleti, ambiyans, autostart) | ✅ |
| M8 | Paketleme & CI (dmg + exe) | ✅ |
| — | Keşfet modu, akıllı karışık, kaldığın yerden devam, yedek/geri yükle | ✅ |
| — | TR/EN dil, açık tema, ilk açılış rehberi (v1.2.0) | ✅ |
| M9 | Mobil (Android) + senkron | 📋 planlandı |

Opsiyonel/ertelenen: equalizer (rodio'da DSP), mini/menubar player, gerçek streaming.

---

Yapan: **Wyclaew**
