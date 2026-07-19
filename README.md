# Resonance

Lightweight, karma-based personal music player. **Mac & Windows** (Android planned: `docs/MOBILE.md`).

- **Lightweight:** Tauri 2 (Rust + system webview). Not Electron.
- **Source:** YouTube (yt-dlp). Spotify / YouTube Music playlists can be imported via link (**no key required** for Spotify).
- **Karma:** Reddit-style upvotes/downvotes on playlists — with time-decay scoring.
- **Learning recommendation:** A lightweight and explainable algorithm that learns what you vote for, **how much you actually listen to**, and **what you add to your playlists** based on the day/time. It discovers **new artists** in the styles you like; songs you love return at the right day/time.
- **Discover:** An endless discovery mode driven entirely by recommendations, without playlists (the queue is always pre-filled).
- **Completely local:** no servers, no accounts, data stays on your device.
- **Turkish / English** interface, **dark / light** theme.

> For personal use only. Extracting audio from YouTube may violate YouTube's ToS; keep the repository private.

## Development

```bash
npm install
npm run build                                  # frontend type check
cd src-tauri && cargo check                    # Rust type check
npm run tauri build -- --debug --bundles app   # local debug bundle
npm run tauri build                            # generate .dmg / .exe
```

Requirements: Node, Rust. Uses system `yt-dlp` + `ffmpeg` if available (fast), otherwise falls back to the embedded sidecar in the application.

### Installation Note for macOS Users

Our application is currently not signed with an official Apple Developer certificate. Therefore, when you download and try to open the `.dmg` file, macOS Gatekeeper may display an **"App is damaged and should be moved to the Trash"** or **"Cannot be verified"** warning. This is completely normal for open-source applications.

To run it without issues, please follow these steps:

1. Open the downloaded `.dmg` file and drag the app into your **Applications** folder.
2. Open **Terminal** on your Mac.
3. Run the following command to remove the macOS quarantine lock:

```bash
xattr -cr /Applications/Resonance.app
```
> *Note: Make sure to replace `Resonance.app` with the exact name of the application.*

4. You can now safely launch the app from your Applications folder or Launchpad! 

> `npm run tauri dev` fails to open the GUI in some environments — see `CLAUDE.md` for details and the validation flow.

## Documentation

| File | Content |
| --- | --- |
| `CLAUDE.md` | **Architecture, critical decisions, pitfalls** — read before starting development |
| `docs/MOBILE.md` | Mobile app plan (audio layer options, phases, risks) |
| `docs/SYNC.md` | Cross-device sync plan (Supabase, schema changes) |
| `docs/RELEASE.md` | Release / CI guide |

## Status

**v1.2.0** — desktop is mature and in daily use. M0–M8 completed; runs flawlessly on Mac, all known download/playback issues on Windows have been resolved.

| Phase | Content | Status |
| --- | --- | --- |
| M0 | Skeleton (Tauri + React + SQLite) | ✅ |
| M1 | Core playback (yt-dlp + Rust audio engine) | ✅ |
| M2 | Library & playlists | ✅ |
| M3 | Karma (upvote/downvote + decay) | ✅ |
| M4 | Learning recommendation algorithm | ✅ |
| M5 | Import (Spotify / YouTube Music) | ✅ |
| M6 | Detailed settings | ✅ |
| M7 | Extras (lyrics, sleep timer, media keys, command palette, ambiance, autostart) | ✅ |
| M8 | Packaging & CI (dmg + exe) | ✅ |
| — | Discover mode, smart shuffle, resume playback, backup/restore | ✅ |
| — | TR/EN language, light theme, onboarding guide (v1.2.0) | ✅ |
| M9 | Mobile (Android) + sync | 📋 planned |

Optional/deferred: equalizer (DSP in rodio), mini/menubar player, true streaming.

---

Created by: **Wyclaew**