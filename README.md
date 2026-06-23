# Resonance

Hafif, karma tabanlı kişisel müzik oynatıcı. Mac & Windows (sonra Android).

- **Hafif:** Tauri (Rust + sistem webview). Electron değil.
- **Kaynak:** YouTube (yt-dlp). Spotify/YouTube Music çalma listeleri link ile içe aktarılır.
- **Karma:** Çalma listelerinde Reddit tarzı upvote/downvote.
- **Öğrenen öneri:** Hangi gün/saat neyi oyladığını öğrenen, hafif ve açıklanabilir
  bir algoritma "Şu An" önerilerini besler.

> Kişisel kullanım içindir. YouTube'dan ses çekmek YouTube ToS'una aykırı olabilir;
> depoyu özel (private) tutun.

## Geliştirme

```bash
npm install
npm run tauri dev      # uygulamayı geliştirme modunda aç
npm run tauri build    # .dmg / .exe üret
```

Gereksinimler: Node, Rust, `yt-dlp`, `ffmpeg`.

## Yol haritası

| Aşama | İçerik | Durum |
| --- | --- | --- |
| M0 | İskelet (Tauri+React+SQLite) | ✅ |
| M1 | Çekirdek oynatma (yt-dlp + Rust ses motoru) | ✅ |
| M2 | Kütüphane & çalma listeleri | ✅ |
| M3 | Karma (upvote/downvote + decay) | ✅ |
| M4 | Öğrenen öneri algoritması | ✅ |
| M5 | İçe aktarma (Spotify / YouTube Music) | ✅ |
| M6 | Detaylı ayarlar | ✅ |
| M7 | Ekstralar (senkron sözler ✅, sleep timer ✅, kısayollar ✅; mini player / global hotkey / EQ opsiyonel) | ◑ |
| M8 | Paketleme & CI (dmg + exe) | |
