# GitHub'a otomatik indirilebilir sürüm atma

Hazır `.dmg` (Mac) ve `.exe` (Windows) dosyalarını GitHub'da indirilebilir
sürüm olarak yayınlamak için. CI (`.github/workflows/release.yml`) her şeyi
otomatik derler — sen sadece bir **etiket (tag)** push edersin.

## Bir kerelik kurulum

1. **GitHub'da repo oluştur** (önerilen: **Private** — yt-dlp ToS/telif nedeniyle).
   github.com → New repository → adını ver → Create.

2. **Yerel projeyi bağla ve gönder** (proje klasöründe):

   ```bash
   cd /Users/erne/Desktop/MusicPlayer
   git add -A
   git commit -m "Resonance ilk sürüm"
   git branch -M main
   git remote add origin https://github.com/KULLANICI_ADIN/resonance.git
   git push -u origin main
   ```

   > `binaries/` klasörü `.gitignore`'da (CI indirir, repoya gitmez). Bu normal.

## Her sürüm çıkarışında

1. Sürüm numarasını **üç dosyada birden** artır (ör. `1.1.0` → `1.1.1`):
   - `package.json` → `"version"`
   - `src-tauri/tauri.conf.json` → `"version"`  ← Hakkında ekranı bunu gösterir
   - `src-tauri/Cargo.toml` → `version`

2. `Cargo.lock`'u yenile (aksi halde CI'da eski sürüm kalır):

   ```bash
   cd src-tauri && cargo check    # Cargo.lock'taki resonance sürümünü günceller
   ```

3. Doğrula: `npm run build` (frontend) temiz geçmeli.

4. Commit'le, sonra bir **sürüm etiketi** push et:

   ```bash
   git add -A && git commit -m "v1.1.0"
   git tag v1.1.0
   git push origin main --tags
   ```

   > Etiket zaten varsa: `git tag -d v1.1.0 && git push origin :refs/tags/v1.1.0` ile sil, sonra tekrar at.

5. Etiket push'lanınca **GitHub Actions** otomatik başlar:
   - macOS runner → `.dmg` üretir
   - Windows runner → `.exe` üretir
   - yt-dlp + ffmpeg'i indirip uygulamaya gömer (kurulum gerekmez)
   - Bir **taslak (draft) Release** oluşturup dosyaları ekler

6. GitHub → repo → **Releases** sekmesine git. Taslağı aç, gözden geçir,
   **Publish release**'e bas. Artık `.dmg` ve `.exe` o sayfadan indirilebilir.

## Notlar

- İlerlemeyi **Actions** sekmesinden izleyebilirsin (derleme ~5-10 dk).
- `GITHUB_TOKEN` otomatik gelir, ek ayar gerekmez.
- **Private repo**: sürümleri yalnızca sen (ve eklediğin kişiler) indirebilir.
  Arkadaşlarınla paylaşmak istersen ya repoyu public yap ya da `.dmg`/`.exe`
  dosyasını doğrudan gönder.
- İmzasız olduğu için indirenler ilk açılışta:
  - **macOS**: sağ tık → Aç (ya da `xattr -cr /Applications/Resonance.app`)
  - **Windows**: SmartScreen → "Yine de çalıştır"
- Şu an **Apple Silicon (.dmg)** ve **Windows x64 (.exe)** üretiliyor. Intel Mac
  da istersen workflow'a `macos-13` + `x86_64-apple-darwin` satırı eklenir.
- Etiket olmadan elle tetiklemek için: Actions → Release → **Run workflow**.
