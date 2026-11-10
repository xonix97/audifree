"""Spotify import without an API key.

Spotify is used only as a *source of track lists*, never as a player.  Public
playlists are read from the server-rendered embed page
(``open.spotify.com/embed/playlist/<id>``), whose ``__NEXT_DATA__`` payload
contains the playlist name, owner, artwork and up to 100 songs.  No account,
OAuth flow, client id or client secret is involved, and no Spotify audio is
requested.

Every Spotify song is then matched to a playable track by ``imports.py``.  If
Spotify changes the embed markup this module breaks the same way the YouTube
scrapers do; :class:`~app.errors.ProviderError` says so explicitly.

``AUDIFREE_SPOTIFY_WEB_BASE`` overrides the site origin so the import path can
be exercised against a local stub.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from . import config
from .errors import BadRequestError, NotFoundError, ProviderError

log = logging.getLogger(__name__)

_PLAYLIST_ID_RE = re.compile(r"^[A-Za-z0-9]{10,64}$")
_PLAYLIST_PATH_RE = re.compile(r"/playlist/([A-Za-z0-9]+)")
_URI_RE = re.compile(r"^spotify:playlist:([A-Za-z0-9]+)$", re.IGNORECASE)
_SPOTIFY_HINT_RE = re.compile(r"spotify\.com|spotify:", re.IGNORECASE)

_EMBED_SCRIPT_RE = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.DOTALL
)

# The embed page is served differently for unknown agents; a normal browser UA
# gets the server-rendered payload.
_BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class SpotifyTrackRef:
    """One Spotify song, before it is matched to a playable provider track."""

    title: str
    artists: list[str] = field(default_factory=list)
    album: str | None = None
    duration: float | None = None
    explicit: bool = False


@dataclass(frozen=True)
class SpotifyPlaylist:
    id: str
    name: str
    description: str | None = None
    owner: str | None = None
    thumbnail: str | None = None
    tracks: list[SpotifyTrackRef] = field(default_factory=list)


# --------------------------------------------------------------------------
# Reference parsing
# --------------------------------------------------------------------------


def parse_spotify_reference(raw: str) -> tuple[str, str]:
    """Turn a pasted Spotify link/URI/id into ``(playlist_id, canonical_url)``."""
    text = raw.strip()
    if not text:
        raise BadRequestError("Paste a Spotify playlist link or id.")

    match = _URI_RE.match(text)
    if match:
        playlist_id = match.group(1)
    elif text.startswith(("http://", "https://")) or _SPOTIFY_HINT_RE.search(text):
        candidate = text if "://" in text else f"https://{text}"
        path_match = _PLAYLIST_PATH_RE.search(urlparse(candidate).path)
        playlist_id = path_match.group(1) if path_match else ""
        if not playlist_id:
            raise BadRequestError(
                "That link does not point to a Spotify playlist "
                "(expected open.spotify.com/playlist/…)."
            )
    else:
        playlist_id = text

    if not _PLAYLIST_ID_RE.fullmatch(playlist_id):
        raise BadRequestError("That does not look like a Spotify playlist id.")

    return playlist_id, f"https://open.spotify.com/playlist/{playlist_id}"


# --------------------------------------------------------------------------
# Embed page scraping
# --------------------------------------------------------------------------


def _best_image(images: Any) -> str | None:
    if not isinstance(images, list):
        return None
    best: str | None = None
    best_area = -1
    for image in images:
        if not isinstance(image, dict) or not image.get("url"):
            continue
        area = int(image.get("maxWidth") or image.get("width") or 0) * int(
            image.get("maxHeight") or image.get("height") or 0
        )
        if area >= best_area:
            best, best_area = str(image["url"]), area
    return best


def _split_artists(subtitle: str) -> list[str]:
    """Split the embed's ``"Artist A, Artist B"`` subtitle.

    Spotify joins multiple artists with ", ". Splitting is a heuristic (a name
    may itself contain a comma), but matching tolerates that and the worst case
    is a slightly noisier search query.
    """
    return [part.strip() for part in subtitle.split(",") if part.strip()]


def _track_ref(item: Any) -> SpotifyTrackRef | None:
    if not isinstance(item, dict):
        return None
    # Playlists can contain podcast episodes; they have no artist and no useful
    # music search, so they are skipped.
    if item.get("entityType") not in (None, "track"):
        return None
    title = item.get("title") or item.get("name")
    if not title:
        return None

    subtitle = str(item.get("subtitle") or "").strip()
    duration = item.get("duration")
    return SpotifyTrackRef(
        title=str(title).strip(),
        artists=_split_artists(subtitle) if subtitle else [],
        duration=round(duration / 1000, 2) if isinstance(duration, (int, float)) else None,
        explicit=bool(item.get("isExplicit")),
    )


def playlist_from_embed(html: str, playlist_id: str) -> SpotifyPlaylist:
    """Parse the ``__NEXT_DATA__`` payload of an embed page (pure, testable)."""
    match = _EMBED_SCRIPT_RE.search(html)
    if not match:
        raise ProviderError(
            "Spotify's page did not contain playlist data. The public embed page "
            "probably changed; try again later or update the app.",
            retryable=False,
        )
    try:
        payload = json.loads(match.group(1))
    except ValueError as exc:
        raise ProviderError("Spotify returned an unreadable embed page.") from exc

    page = payload.get("props", {}).get("pageProps", {})
    entity = (page.get("state") or {}).get("data", {}).get("entity")
    if not isinstance(entity, dict):
        raise ProviderError("Spotify's embed page had no playlist entity.")

    if entity.get("type") not in (None, "playlist"):
        raise ProviderError(
            f"Spotify returned a {entity.get('type')!r} page, not a playlist."
        )

    tracks = [
        reference
        for reference in (_track_ref(item) for item in entity.get("trackList") or [])
        if reference is not None
    ]

    visual = entity.get("visualIdentity")
    thumbnail = _best_image(visual.get("image") if isinstance(visual, dict) else None)
    if thumbnail is None:
        thumbnail = _best_image(entity.get("coverArt"))

    owner = entity.get("subtitle")
    return SpotifyPlaylist(
        id=str(entity.get("id") or playlist_id),
        name=str(entity.get("name") or entity.get("title") or "Spotify playlist").strip(),
        description=None,
        owner=str(owner).strip() if owner else None,
        thumbnail=thumbnail,
        tracks=tracks,
    )


def fetch_playlist(playlist_id: str) -> SpotifyPlaylist:
    """Download and parse the public embed page for ``playlist_id``."""
    url = f"{config.SPOTIFY_WEB_BASE}/embed/playlist/{playlist_id}"
    try:
        with httpx.Client(
            timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=True
        ) as client:
            response = client.get(
                url,
                headers={
                    "User-Agent": _BROWSER_UA,
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
    except httpx.HTTPError as exc:
        raise ProviderError(f"Could not reach Spotify: {exc}") from exc

    if response.status_code == 404:
        raise NotFoundError("Spotify playlist not found (is it public?)")
    if response.status_code in (401, 403):
        raise ProviderError(
            "Spotify refused that page. Only public playlists can be imported.",
            retryable=False,
        )
    if response.status_code == 429:
        raise ProviderError("Spotify rate limit reached; try again in a minute.")
    if response.status_code >= 400:
        raise ProviderError(f"Spotify returned HTTP {response.status_code}.")

    playlist = playlist_from_embed(response.text, playlist_id)
    log.info(
        "spotify embed %s: %s (%d songs)",
        playlist_id,
        playlist.name,
        len(playlist.tracks),
    )
    return playlist
