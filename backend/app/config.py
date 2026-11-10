"""Runtime configuration, entirely driven by environment variables.

Electron generates a random port and bearer token for every launch, so the
sidecar never listens on a well-known port and cannot be driven by other local
processes without the token.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _data_root() -> Path:
    """Per-user data dir for the platform.

    Windows uses %LOCALAPPDATA% (falling back to %APPDATA%), macOS uses
    Application Support, and Linux follows XDG.  The environment override
    (``AUDIFREE_DATA_DIR``) below always wins, which is what tests use.
    """
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if base:
            return Path(base) / "Audifree"
        return Path.home() / "AppData" / "Local" / "Audifree"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Audifree"
    xdg = os.environ.get("XDG_DATA_HOME", "").strip()
    base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return base / "audifree"


APP_NAME = "Audifree"
VERSION = "0.1.0"

# 0 means "let the OS choose"; Electron always passes an explicit free port.
PORT: int = _env_int("AUDIFREE_PORT", 0)
HOST = "127.0.0.1"

# Shared secret between Electron and the sidecar.  Empty disables auth, which
# is only useful when running the backend by hand during development.
TOKEN = os.environ.get("AUDIFREE_TOKEN", "")

PROVIDER = os.environ.get("AUDIFREE_PROVIDER", "youtube_music").strip().lower()

DATA_DIR = Path(os.environ.get("AUDIFREE_DATA_DIR", str(_data_root())))
CACHE_DIR = DATA_DIR / "cache"

# Stream URLs from YouTube's CDN expire after roughly six hours; we refresh a
# little sooner so a track never dies mid-playback.  The renderer also forces a
# refresh when the media element reports an error.
STREAM_CACHE_TTL_SECONDS = _env_int("AUDIFREE_STREAM_TTL", 50 * 60)
STREAM_CACHE_MAX_ENTRIES = 200

# ytmusicapi's anonymous browse interface.  No account, no cookies.
YT_MUSIC_LANGUAGE = os.environ.get("AUDIFREE_LANG", "en")

# Spotify is only used to *read* public playlists for import; playback always
# resolves through the configured music provider.  The public embed page is
# scraped, so no account or API credentials are needed.
SPOTIFY_WEB_BASE = os.environ.get(
    "AUDIFREE_SPOTIFY_WEB_BASE", "https://open.spotify.com"
).rstrip("/")

# Songs are matched against the provider concurrently.  Search calls are
# network-bound, so a handful of workers takes a long playlist from minutes to
# seconds; the cap keeps YouTube from rate-limiting the whole import.
IMPORT_WORKERS = max(1, min(_env_int("AUDIFREE_IMPORT_WORKERS", 8), 16))

LRCLIB_BASE_URL = "https://lrclib.net/api"
USER_AGENT = f"Audifree/{VERSION} (personal desktop client; local use)"
