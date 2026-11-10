# Audifree

An Apple Music–style desktop streaming client for Linux and Windows, built
around Electron, React and a Python FastAPI sidecar. It streams from YouTube
Music through unofficial scrapers and never writes music to disk.

Personal, educational use only. No ads, no accounts, no telemetry, no cloud sync.

> **Status: phase 3 in progress.** Backend, provider abstraction, playback, the
> liquid-glass UI, full-screen Now Playing, synced lyrics and the local SQLite
> library (custom playlists, YouTube Music import and key-free Spotify playlist
> import) all work, and Windows builds as a standalone portable `.exe`.
> Favourites and history, queue persistence and MPRIS are still to come.

---

## What works today

**Catalog & playback**
- Anonymous YouTube Music search across songs, albums, artists and playlists,
  with detail pages for each.
- Audio URLs resolved right before playback by `yt-dlp`, cached in memory for
  50 minutes, and re-resolved automatically when the CDN URL expires.
- Audio-only format selection (m4a preferred, WebM/Opus fallback).
- Session "Recently played" list feeding Listen Now.

**Local library (SQLite)**
- Custom playlists stored in the per-user data dir —
  `~/.local/share/audifree/library.db` on Linux,
  `%LOCALAPPDATA%\Audifree\library.db` on Windows (override with
  `AUDIFREE_DATA_DIR`): create, rename, delete, add songs from any track row's
  **+** button or from an album/playlist header, remove individual tracks.
- YouTube Music playlist import from a pasted link or bare id. The import keeps
  a metadata snapshot, so the playlist still renders if it is later removed
  upstream; re-importing the same link refreshes that entry instead of creating
  a duplicate.
- Spotify playlist import from a public link with **no API key or account**:
  the sidecar reads Spotify's public embed page. Spotify only provides titles
  and artists, so every song is matched to a playable YouTube Music track by
  title, artist and duration, in parallel across a bounded worker pool (about
  8× faster than a sequential pass). Unmatched songs are reported, not silently
  dropped. The public page exposes up to 100 songs per playlist.
- Only playlist definitions and track metadata are stored — audio is never
  written to disk.

**Liquid-glass UI**
- Frameless window, translucent sidebar, main panel and now-playing dock, all
  sharing one glass material built from `backdrop-filter: blur() saturate()`,
  an SVG `feDisplacementMap` refraction rim, 1px inner highlights, a specular
  top-edge sheen and soft layered shadows.
- Apple Music layout: sidebar (Listen Now, Browse, Search, Library, Playlists),
  main content area, bottom now-playing bar, slide-up Now Playing view.
- Background is a slowly drifting monochrome mesh whose grey levels come from
  the current album art (canvas sampling, no dependency); it crossfades between
  tracks.
- Light/dark themes follow the system; all radii are 20–28px; Inter is the
  primary font with SF/System fallbacks.
- Framer Motion springs for the Now Playing sheet and dialogs; tilt parallax on
  the artwork; `prefers-reduced-motion` disables animation.
- **Settings → Reduce glass effects** swaps blur/refraction for solid panels
  (persisted; use it on weak GPUs).
- Window controls are renderer-drawn and fully transparent at rest (no native
  overlay strip); macOS keeps its traffic lights. One instance per user profile.

**Now Playing & lyrics**
- Large artwork with pointer-driven parallax, glass pill transport, scrubber,
  volume, and a lyrics panel.
- LRCLIB lyrics: exact match first, then fuzzy search; enhanced LRC word tags
  are parsed and highlighted when present, otherwise line-synced highlighting
  with smooth auto-scroll. Plain lyrics and "instrumental" states supported.
- `Esc` closes Now Playing and dialogs.

**Reliability**
- `/api/health` provider probe + in-app banner with **Update yt-dlp**
  (`pip install -U` inside the app venv) and **Restart backend**.
- Verified on CachyOS Wayland (KDE); X11 fallback flags documented.
- Runs on Windows 10/11 x64 from a single portable executable (no Python or
  Node install required) and keeps its data in `%LOCALAPPDATA%\Audifree`.

Phase 3 has started with the local library: custom playlists plus YouTube Music
and Spotify playlist imports now live in SQLite. Still to come: favourites and
persisted listening history, the queue UI (drag-to-reorder, shuffle, repeat,
gapless-ish preloading), MPRIS + global media keys + tray + notifications,
Last.fm scrobbling, and AppImage/PKGBUILD packaging with a `.desktop` file.

---

## Requirements

**Linux**

- CachyOS or another Arch-based distro (KDE Plasma on Wayland or X11)
- Python 3.10+ (3.14 tested)
- Node.js 22.12+ (26 tested) and npm
- `ffmpeg`, `yt-dlp`
- PipeWire or PulseAudio

**Windows**

- Windows 10 or 11, x64
- Nothing else — the portable `.exe` carries Electron and a private Python
  3.12 runtime with all backend dependencies

## Windows

Download or build `Audifree-<version>-windows-x64.exe` and run it. It is a
portable single-file build (NSIS self-extractor): no installer, no admin rights,
and no Python/Node on the machine. The app unpacks itself to a temp folder for
the session and keeps your library in `%LOCALAPPDATA%\Audifree`.

The binary is unsigned, so Windows SmartScreen may warn on first launch
(**More info → Run anyway**).

To build it yourself:

```bash
bash scripts/prepare-win-python.sh   # assemble the Windows Python runtime (needs uv)
npm install
npm run dist:win                     # -> release/Audifree-<version>-windows-x64.exe
```

The Python runtime is built from the embeddable CPython 3.12 zip plus win_amd64
wheels, so this cross-build works from Linux (electron-builder uses Wine for the
Windows executable metadata) as well as from Windows. `backend/runtime/` is
generated and gitignored.

## Setup

```bash
git clone <your-fork> audifree && cd audifree
bash scripts/setup.sh
```

The script installs `python python-pip nodejs npm ffmpeg yt-dlp` with `pacman`
(sudo), creates `backend/.venv`, installs `backend/requirements.txt`, then runs
`npm install`.

```bash
bash scripts/setup.sh --skip-pacman   # no sudo / packages already installed
npm run setup                          # same script
```

`npm install` runs a `postinstall` hook that downloads the Electron binary
(Electron 45 no longer does this automatically). If it is ever missing:

```bash
npx install-electron
```

### Spotify import (no setup needed)

Spotify is only used to read **public** playlists; playback still goes through
YouTube Music. There is no Spotify account, app registration, client id, secret
or token involved: the sidecar fetches the public embed page
(`open.spotify.com/embed/playlist/<id>`) and reads the playlist data embedded in
it, exactly like the YouTube Music scrapers read that site's pages.

Paste a playlist link such as
`https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M` into the Playlists
page import box. Private, collaborative and account-only playlists are not
visible without a login and are rejected. Spotify's audio is never requested;
each song is replaced by its YouTube Music match.

Two things to know:

- The embed page exposes the **first 100 songs** of a playlist. Longer playlists
  import their first 100 tracks; the note afterwards reports matching results.
- If Spotify changes that page, the import fails loudly ("Spotify's page did not
  contain playlist data") instead of importing nothing — that is the same
  scraper fragility as the YouTube side, not something an API key would fix.

## Run

```bash
npm run dev      # Vite + Electron; Electron spawns the Python sidecar itself
```

Production-style run from a local build:

```bash
npm run build
npx electron .
```

Backend only (port 8787, no auth, useful for curl):

```bash
npm run backend
```

### npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | compile Electron main, start Vite, launch Electron |
| `npm run build` | typecheck, build renderer to `dist/`, compile main to `dist-electron/` |
| `npm run typecheck` | renderer + Electron TypeScript checks |
| `npm start` | `build` then launch Electron |
| `npm run backend` | run the FastAPI sidecar on `127.0.0.1:8787` |
| `npm run setup` | system deps + venv + npm install |

Packaging (`npm run package`, AppImage, PKGBUILD, `.desktop`) is added in phase 3.

---

## Architecture

```
┌──────────────────────────── Electron 45 ────────────────────────────┐
│ main process (dist-electron/main.js)                                │
│   • Wayland flags, frameless window, IPC, single-instance lock       │
│   • spawns sidecar on a free 127.0.0.1 port with a random token     │
│                                                                     │
│ renderer (React + Vite + framer-motion)                              │
│   • window.audifree bridge from preload (no Node in renderer)       │
│   • glass UI, mesh, Now Playing, lyrics, queue UI (phase 3)         │
│   • <audio> plays the CDN URL returned by the sidecar               │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP + Bearer token
┌───────────────────────────────▼─────────────────────────────────────┐
│ Python sidecar (backend/app)                                        │
│   FastAPI ── providers/MusicProvider ── YouTubeMusicProvider        │
│                   │                        ├─ ytmusicapi (metadata)  │
│                   │                        └─ yt-dlp (stream URLs)   │
│                   ├─ StreamCache (50 min, memory only)              │
│                   ├─ LyricsService (LRCLIB) + LRC parser            │
│                   ├─ Spotify embed scraper (public playlists, no key) │
│                   └─ LibraryStore (SQLite: playlists + track cache) │
└─────────────────────────────────────────────────────────────────────┘
```

| Path | Role |
| --- | --- |
| `electron/main.ts` | window, Chromium flags, IPC, window controls, sidecar lifecycle |
| `electron/sidecar.ts` | port/token generation, spawn, health wait, restart |
| `electron/preload.ts` | the only renderer↔main bridge |
| `backend/app/providers/base.py` | `MusicProvider` interface, caching, health, dep updates |
| `backend/app/providers/youtube_music.py` | YouTube Music implementation |
| `backend/app/providers/__init__.py` | provider registry (swap source here) |
| `backend/app/library.py` | SQLite playlists, track snapshots, import upsert |
| `backend/app/spotify.py` | Spotify public-embed scraper, link parsing |
| `backend/app/imports.py` | parallel song matching + background import jobs |
| `backend/app/services/lyrics.py` | LRCLIB exact match + fuzzy search |
| `backend/app/services/lrc.py` | LRC parser (line + word timestamps) |
| `backend/app/stream_cache.py` | bounded LRU of resolved URLs |
| `src/player/PlayerProvider.tsx` | audio element, queue, retry logic, session history |
| `src/components/GlassPanel.tsx` | the glass material component |
| `src/components/GlassFilters.tsx` | SVG refraction filter defs |
| `src/lib/palette.ts` | canvas album-art tone extraction |
| `src/components/MeshBackground.tsx` | animated, crossfading colour mesh |
| `src/components/NowPlayingView.tsx` | full-screen player + lyrics layout |
| `src/components/LyricsPanel.tsx` | synced lyric highlight + auto-scroll |
| `src/components/Sidebar.tsx` | Apple Music navigation shell |
| `src/settings/SettingsProvider.tsx` | persisted "Reduce glass effects" |
| `src/api/client.ts` | token-aware fetch wrapper |

### Adding another source

Implement `MusicProvider` in a new file under `backend/app/providers/`, then add
it to `_FACTORIES` in `providers/__init__.py`. The HTTP layer and UI need no
changes; only stream resolution and metadata mapping are provider-specific.

### API surface

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | provider probe (cached 60 s), dependency versions |
| POST | `/api/health/update-deps` | `pip install -U` in the venv |
| GET | `/api/search?q=&filter=&limit=` | filter: `all\|songs\|albums\|artists\|playlists` |
| GET | `/api/albums/{id}` | album + tracks |
| GET | `/api/artists/{id}` | top songs, albums, singles |
| GET | `/api/playlists/{id}` | playlist + tracks |
| GET | `/api/stream/{videoId}?refresh=1` | signed URL, ~50 min cache |
| GET | `/api/lyrics?title=&artist=&album=&duration=` | synced + plain lyrics |
| GET | `/api/library/playlists` | local playlists with track counts |
| POST | `/api/library/playlists` | create (JSON `{name, description?}`) |
| GET | `/api/library/playlists/{id}` | playlist + stored tracks |
| PATCH | `/api/library/playlists/{id}` | rename / edit description |
| DELETE | `/api/library/playlists/{id}` | delete playlist |
| POST | `/api/library/playlists/{id}/tracks` | add `{tracks: [...]}` |
| DELETE | `/api/library/playlists/{id}/tracks/{entryId}` | remove one track |
| POST | `/api/library/import` | import/refresh a YT Music playlist `{url}` |
| POST | `/api/library/import/spotify` | start a Spotify import, returns a job (202) |
| GET | `/api/library/import/spotify/{jobId}` | import progress: state, counts, skipped songs |

All non-OPTIONS requests require `Authorization: Bearer <AUDIFREE_TOKEN>`.

### Design system notes

- The colour scheme is strictly black, white and one accent colour. Surfaces,
  text and the mesh are neutral greys; `--accent` (plus `--accent-strong` /
  `--accent-soft`) is the only chromatic family and is reserved for focus rings,
  the active nav item, primary actions, the switch/equalizer and the close-button
  hover. `--danger`, `--warning` and `--success` exist only for backend status
  banners and inline error text. Restyling the accent is a one-token change.
- Glass tokens live at the top of `src/styles.css` (`--glass-tint`,
  `--glass-blur`, `--glass-border`, …). `<GlassPanel tone="...">` only changes
  which token block applies, so restyling happens in one place.
- The refraction layer is masked to the top and bottom edges so the centre stays
  crisp. If a GPU renders it badly, use Settings → Reduce glass effects; that
  removes `backdrop-filter`, the SVG filter and the animated mesh blur.
- Palette sampling uses an offscreen canvas and YouTube's CORS-enabled thumbnails.
  The artwork's hue and saturation are discarded before the mesh renders, so only
  its luminance shapes the background. Failures fall back to a deterministic
  palette derived from the album id, so the mesh never flashes grey.

---

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUDIFREE_PORT` | `0` (OS picks) | sidecar port |
| `AUDIFREE_TOKEN` | empty (auth off) | sidecar bearer token |
| `AUDIFREE_DATA_DIR` | `~/.local/share/audifree` (Linux), `%LOCALAPPDATA%\Audifree` (Windows) | local data root (SQLite lives here) |
| `AUDIFREE_PROVIDER` | `youtube_music` | registry key |
| `AUDIFREE_STREAM_TTL` | `3000` | stream cache seconds |
| `AUDIFREE_LANG` | `en` | ytmusicapi browse language |
| `AUDIFREE_SPOTIFY_WEB_BASE` | `https://open.spotify.com` | import source origin (stub/proxy for tests) |
| `AUDIFREE_IMPORT_WORKERS` | `8` | parallel song matches per Spotify import (1–16) |
| `AUDIFREE_PYTHON` | venv python | override interpreter path |
| `AUDIFREE_DISABLE_GPU` | unset | set to `1` to disable GPU compositing |

---

## Troubleshooting

### Search or playback suddenly breaks

YouTube changes its frontend regularly and both `ytmusicapi` and `yt-dlp` are
unofficial. Symptoms: empty results, `Could not resolve an audio stream`,
`403`/`Signature extraction failed`.

1. Use **Update yt-dlp** in the in-app banner, or
   `backend/.venv/bin/pip install -U yt-dlp ytmusicapi`.
2. Restart the app (module reloads happen in-process, but a restart is safest).
3. Still broken? Check upstream `yt-dlp` issues; nothing in this app patches
   YouTube.

### Stream resolved but playback stops instantly

Resolved URLs are IP-bound and expire. The player re-requests a fresh URL once
per track; if the second attempt also fails, the track is usually region-locked
or removed.

### Glass effects look noisy / the window stutters

Open Settings → **Reduce glass effects**. This removes backdrop blur, the SVG
refraction layer and mesh blur in one switch. On NVIDIA/Wayland you can also try
`AUDIFREE_DISABLE_GPU=1 npm run dev` or `--disable-features=Vulkan`.

### Wayland

The app starts with `--ozone-platform-hint=auto`, `WaylandWindowDecorations` and
`enable-wayland-ime`, and draws its own window controls, so it runs natively
under KDE Plasma Wayland.

- Force native Wayland: `npx electron . --ozone-platform=wayland`
- Force XWayland: `npx electron . --ozone-platform=x11`
- Blurry window on fractional scaling: adjust Plasma's per-app scaling; the
  glass layer is resolution independent.
- No window decorations under a compositor that ignores client-side decoration:
  switch to `x11` as above.
- IME not working in search: verify `GTK_IM_MODULE`/`QT_IM_MODULE` are set for
  your session.

### Windows

- **SmartScreen blocks the first launch** — the portable exe is unsigned; choose
  **More info → Run anyway**, or build it yourself.
- **"Backend did not become healthy"** — antivirus may be holding the extracted
  `python.exe`. Allow the app in Defender, or set `AUDIFREE_PYTHON` to a local
  Python 3.10+ install with `backend/requirements.txt`.
- **Where is my library?** `%LOCALAPPDATA%\Audifree\library.db`; back that file
  up and delete it to reset.
- **Portable app starts slow the first time** — it unpacks Electron and the
  Python runtime (~120 MB) to a temp folder on launch.

### NVIDIA / GPU quirks

Observed on CachyOS with recent drivers:

```
'--ozone-platform=wayland' is not compatible with Vulkan.
```

The app still runs (software compositing for the GPU process). Options:

```bash
npx electron . --disable-features=Vulkan         # disable Vulkan
npx electron . --use-gl=angle --use-angle=gl     # prefer ANGLE/OpenGL
AUDIFREE_DISABLE_GPU=1 npm run dev               # no GPU compositing at all
```

If glass looks wrong or scrolling stutters, try the last one first.

### No audio / wrong output device

1. `wpctl status` (PipeWire) or `pactl info` (PulseAudio) and check the default
   sink.
2. `systemctl --user restart pipewire pipewire-pulse wireplumber`.
3. Test outside the app: `pw-play /usr/share/sounds/alsa/Front_Center.wav`.
4. Check KDE's per-application volume for `Audifree` / `Chromium`.
5. Start from a terminal (`npm run dev`) so environment variables from a working
   session are inherited.

### Spotify import fails

- **"Spotify playlist not found (is it public?)"** — only public playlists are
  readable without a login; private and collaborative lists return this.
- **"Spotify's page did not contain playlist data"** — the public embed markup
  changed. Check for an app update; until then the link can't be read (an API
  key would not help here, the page layout is the source).
- **"Spotify refused that page"** — Spotify is blocking the request (region or
  bot protection); retry later, or set `AUDIFREE_SPOTIFY_WEB_BASE` to a mirror.
- **Rate limit** — lower `AUDIFREE_IMPORT_WORKERS` (e.g. `4`) and retry after
  the time Spotify reports.
- **Some songs were not matched** — the note after the import lists them (up to
  three, plus a count). Titles that exist only on Spotify/region-locked tracks
  usually fail; import the link again to retry after the provider's catalogue or
  yt-dlp updates.
- **A long playlist only imported 100 songs** — the public embed page only
  exposes the first 100.

### Playlists disappeared / library database is corrupt

The library is `library.db` in your data dir (see the table above; or under your
`AUDIFREE_DATA_DIR`). With the app closed, back it up with `cp` or delete it to
start empty — the database holds only playlist definitions and track metadata,
so nothing else is affected.

### Backend fails to start

The banner prints the Python error. Common causes:

- `backend/.venv` missing → `bash scripts/setup.sh --skip-pacman`
- wrong interpreter → `AUDIFREE_PYTHON=/usr/bin/python3 npm run dev`
- stale sidecar process → `pkill -f 'python -u -m app.main'`

The sidecar logs to the terminal with a `[backend]` prefix.

### Electron binary missing

`npm install` downloads it via the `postinstall` hook. If it did not run:

```bash
npx install-electron
```

---

## Privacy and legal

- No accounts, ads, telemetry, analytics or crash reporting.
- The sidecar listens on `127.0.0.1` only and requires a per-launch token.
- Playlist definitions and the track metadata you keep are stored in a local
  SQLite file (`library.db`). No audio, account data or listening history is
  written to disk.
- A Spotify import fetches only the public embed page for that playlist; no
  account, login or credential is used, and Spotify's audio is never requested.
- Stream URLs are cached in RAM for ~50 minutes; no audio is written to disk.
- Lyrics requests go to LRCLIB; metadata and streams come from unofficial
  YouTube Music scrapers. **These break periodically and this project cannot
  guarantee them.**
- Intended for personal, educational use. You are responsible for complying with
  the terms of service of the services involved. No DRM circumvention is
  implemented.
