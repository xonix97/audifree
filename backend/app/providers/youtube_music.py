"""YouTube Music provider.

Metadata comes from ``ytmusicapi``'s anonymous browse endpoints (no account, no
cookies) and audio URLs from ``yt-dlp``.  Both are unofficial scrapers: when
YouTube changes its frontend they break, which is why the app ships an "update
dependencies" action and a health banner.
"""

from __future__ import annotations

import importlib
import importlib.metadata
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Iterable
from urllib.parse import parse_qs, urlparse

import yt_dlp
from ytmusicapi import YTMusic

from .. import config
from ..errors import NotFoundError, ProviderError
from ..models import (
    AlbumDetail,
    AlbumRef,
    AlbumSummary,
    ArtistDetail,
    ArtistRef,
    ArtistSummary,
    DependencyVersions,
    PlaylistDetail,
    PlaylistSummary,
    SearchFilter,
    SearchResults,
    StreamInfo,
    Track,
)
from .base import MusicProvider

log = logging.getLogger(__name__)

_TRACK_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,32}$")

# Preferred container for Chromium playback. Both m4a and opus play fine, but
# m4a (AAC) avoids occasional WebM/Opus edge cases on older PipeWire setups.
_MIME_PREFERENCE = ("audio/mp4", "audio/webm", "audio/ogg")


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _best_thumbnail(thumbnails: Any) -> str | None:
    """Pick the highest-resolution artwork URL from ytmusicapi's list."""
    best: str | None = None
    best_area = -1
    for thumb in _as_list(thumbnails):
        if not isinstance(thumb, dict):
            continue
        url = thumb.get("url")
        if not url:
            continue
        area = int(thumb.get("width") or 0) * int(thumb.get("height") or 0)
        if area >= best_area:
            best, best_area = url, area
    return best


def _artists(value: Any) -> list[ArtistRef]:
    if isinstance(value, str):
        return [ArtistRef(name=value)] if value.strip() else []
    result: list[ArtistRef] = []
    for entry in _as_list(value):
        if isinstance(entry, str):
            if entry.strip():
                result.append(ArtistRef(name=entry))
        elif isinstance(entry, dict):
            name = entry.get("name") or entry.get("artist")
            if not name:
                continue
            result.append(
                ArtistRef(id=entry.get("id") or entry.get("browseId"), name=str(name))
            )
    return result


def _album_ref(value: Any) -> AlbumRef | None:
    if isinstance(value, str):
        return AlbumRef(name=value) if value.strip() else None
    if isinstance(value, dict):
        name = value.get("name") or value.get("title")
        if not name:
            return None
        return AlbumRef(id=value.get("id") or value.get("browseId"), name=str(name))
    return None


def _seconds(value: Any) -> float | None:
    """ytmusicapi returns durations as seconds, "3:45" or None."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if ":" in text:
        total = 0.0
        try:
            for part in text.split(":"):
                total = total * 60 + float(part)
        except ValueError:
            return None
        return total
    try:
        return float(text)
    except ValueError:
        return None


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _expiry_from_url(url: str) -> datetime | None:
    """Read the CDN's signed ``expire`` parameter, when present."""
    try:
        query = parse_qs(urlparse(url).query)
    except ValueError:
        return None
    for key in ("expire", "expire_at"):
        values = query.get(key)
        if values and values[0].isdigit():
            return datetime.fromtimestamp(int(values[0]), tz=timezone.utc)
    return None


class YouTubeMusicProvider(MusicProvider):
    id = "youtube_music"
    display_name = "YouTube Music"
    dependency_packages = ("yt-dlp", "ytmusicapi")

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # ytmusicapi's client keeps a requests session; it is not safe to share
        # across threads, so each worker gets its own lightweight client.
        self._thread_state = threading.local()
        self._client_lock = threading.Lock()
        self._generation = 0

    # -- client ------------------------------------------------------------

    def _build_client(self) -> YTMusic:
        return YTMusic(language=config.YT_MUSIC_LANGUAGE)

    def _client(self) -> YTMusic:
        state = self._thread_state
        generation = getattr(state, "generation", None)
        client = getattr(state, "client", None)
        if client is None or generation != self._generation:
            with self._client_lock:
                # Anonymous client construction performs no network I/O.
                client = self._build_client()
            state.client = client
            state.generation = self._generation
        return client

    def _call(self, operation: str, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001 - scraper failures vary wildly
            log.warning("%s failed: %s", operation, exc, exc_info=log.isEnabledFor(logging.DEBUG))
            raise ProviderError(
                f"{self.display_name} request failed ({operation}): {exc}"
            ) from exc

    # -- search ------------------------------------------------------------

    def search(
        self, query: str, *, filter: SearchFilter = "all", limit: int = 20
    ) -> SearchResults:
        query = query.strip()
        if not query:
            return SearchResults(query="")

        kinds: tuple[str, ...]
        if filter == "all":
            kinds = ("songs", "albums", "artists", "playlists")
        else:
            kinds = (filter,)

        collected: dict[str, list[Any]] = {}
        errors: list[Exception] = []

        # One request per category, in parallel; each thread uses its own client.
        with ThreadPoolExecutor(max_workers=len(kinds)) as pool:
            futures = {
                pool.submit(self._search_kind, kind, query, limit): kind
                for kind in kinds
            }
            for future in as_completed(futures):
                kind = futures[future]
                try:
                    collected[kind] = future.result()
                except Exception as exc:  # noqa: BLE001
                    errors.append(exc)
                    log.warning("search category %s failed: %s", kind, exc)

        if len(errors) == len(kinds):
            first = errors[0]
            if isinstance(first, ProviderError):
                raise first
            raise ProviderError(f"Search failed: {first}") from first

        return SearchResults(
            query=query,
            songs=collected.get("songs", []),
            albums=collected.get("albums", []),
            artists=collected.get("artists", []),
            playlists=collected.get("playlists", []),
        )

    def _search_kind(self, kind: str, query: str, limit: int) -> list[Any]:
        raw = self._call(
            f"search:{kind}", self._client().search, query, filter=kind, limit=limit
        )
        items = [item for item in _as_list(raw) if isinstance(item, dict)]

        if kind == "songs":
            return [track for track in (self._track(item) for item in items) if track]
        if kind == "albums":
            return [album for album in (self._album_summary(item) for item in items) if album]
        if kind == "artists":
            return [
                artist
                for artist in (self._artist_summary(item) for item in items)
                if artist
            ]
        if kind == "playlists":
            return [
                playlist
                for playlist in (self._playlist_summary(item) for item in items)
                if playlist
            ]
        return []

    # -- mapping -----------------------------------------------------------

    def _track(self, item: Any, *, album: AlbumRef | None = None) -> Track | None:
        if not isinstance(item, dict):
            return None
        video_id = item.get("videoId") or item.get("id")
        title = item.get("title") or item.get("name")
        if not video_id or not title:
            return None
        return Track(
            id=str(video_id),
            provider=self.id,
            title=str(title),
            artists=_artists(item.get("artists")),
            album=_album_ref(item.get("album")) or album,
            duration=_seconds(item.get("duration_seconds") or item.get("duration")),
            thumbnail=_best_thumbnail(item.get("thumbnails")),
            explicit=bool(item.get("isExplicit")),
            track_number=item.get("trackNumber"),
        )

    def _album_summary(self, item: Any) -> AlbumSummary | None:
        if not isinstance(item, dict):
            return None
        browse_id = item.get("browseId") or item.get("id")
        title = item.get("title") or item.get("name")
        if not browse_id or not title:
            return None
        year = item.get("year")
        return AlbumSummary(
            id=str(browse_id),
            provider=self.id,
            title=str(title),
            artists=_artists(item.get("artists")),
            year=str(year) if year else None,
            thumbnail=_best_thumbnail(item.get("thumbnails")),
            track_count=item.get("trackCount") or item.get("itemCount"),
            kind=str(item.get("type") or "album").lower(),
        )

    def _artist_summary(self, item: Any) -> ArtistSummary | None:
        if not isinstance(item, dict):
            return None
        browse_id = item.get("browseId") or item.get("id")
        name = item.get("artist") or item.get("name")
        if not browse_id or not name:
            return None
        return ArtistSummary(
            id=str(browse_id),
            provider=self.id,
            name=str(name),
            thumbnail=_best_thumbnail(item.get("thumbnails")),
            subscribers=item.get("subscribers"),
        )

    def _playlist_summary(self, item: Any) -> PlaylistSummary | None:
        if not isinstance(item, dict):
            return None
        browse_id = item.get("browseId") or item.get("playlistId") or item.get("id")
        title = item.get("title") or item.get("name")
        if not browse_id or not title:
            return None
        owner = item.get("author") or item.get("owner")
        if isinstance(owner, dict):
            owner = owner.get("name")
        return PlaylistSummary(
            id=str(browse_id),
            provider=self.id,
            title=str(title),
            owner=str(owner) if owner else None,
            thumbnail=_best_thumbnail(item.get("thumbnails")),
            track_count=item.get("itemCount") or item.get("trackCount"),
        )

    # -- detail ------------------------------------------------------------

    def get_album(self, album_id: str) -> AlbumDetail:
        raw = self._call("album", self._client().get_album, album_id)
        if not isinstance(raw, dict) or not raw.get("title"):
            raise NotFoundError(f"Album {album_id} not found")

        reference = AlbumRef(id=album_id, name=str(raw["title"]))
        tracks: list[Track] = []
        for index, entry in enumerate(_as_list(raw.get("tracks"))):
            track = self._track(entry, album=reference)
            if track is None:
                continue
            if track.track_number is None:
                track.track_number = index + 1
            tracks.append(track)

        year = raw.get("year")
        return AlbumDetail(
            id=album_id,
            provider=self.id,
            title=str(raw["title"]),
            artists=_artists(raw.get("artists")),
            year=str(year) if year else None,
            thumbnail=_best_thumbnail(raw.get("thumbnails")),
            track_count=raw.get("trackCount") or len(tracks) or None,
            description=raw.get("description"),
            tracks=tracks,
        )

    def get_artist(self, artist_id: str) -> ArtistDetail:
        raw = self._call("artist", self._client().get_artist, artist_id)
        if not isinstance(raw, dict) or not raw.get("name"):
            raise NotFoundError(f"Artist {artist_id} not found")

        def collect(section: str) -> list[Any]:
            block = raw.get(section)
            if isinstance(block, dict):
                return _as_list(block.get("results"))
            return _as_list(block)

        def albums(section: str) -> list[AlbumSummary]:
            return [
                album
                for album in (self._album_summary(item) for item in collect(section))
                if album
            ]

        return ArtistDetail(
            id=artist_id,
            provider=self.id,
            name=str(raw["name"]),
            thumbnail=_best_thumbnail(raw.get("thumbnails")),
            subscribers=raw.get("subscribers"),
            description=raw.get("description"),
            top_songs=[
                track for track in (self._track(item) for item in collect("songs")) if track
            ],
            albums=albums("albums"),
            singles=albums("singles"),
        )

    def get_playlist(self, playlist_id: str) -> PlaylistDetail:
        raw = self._call(
            "playlist", self._client().get_playlist, playlist_id, limit=200
        )
        if not isinstance(raw, dict) or not raw.get("title"):
            raise NotFoundError(f"Playlist {playlist_id} not found")

        owner = raw.get("owner")
        if isinstance(owner, dict):
            owner = owner.get("name")

        return PlaylistDetail(
            id=playlist_id,
            provider=self.id,
            title=str(raw["title"]),
            owner=str(owner) if owner else None,
            thumbnail=_best_thumbnail(raw.get("thumbnails")),
            track_count=raw.get("trackCount") or len(_as_list(raw.get("tracks"))) or None,
            description=raw.get("description"),
            tracks=[
                track
                for track in (self._track(item) for item in _as_list(raw.get("tracks")))
                if track
            ],
        )

    # -- playback ----------------------------------------------------------

    def _resolve_stream(self, track_id: str) -> StreamInfo:
        if not _TRACK_ID_RE.match(track_id):
            raise NotFoundError(f"Invalid track id: {track_id!r}")

        watch_url = f"https://music.youtube.com/watch?v={track_id}"
        options = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
            "format": "bestaudio/best",
            "socket_timeout": 20,
            "retries": 2,
            "extractor_retries": 1,
            "cachedir": False,
            # Never write media to disk: this is a streaming client only.
            "outtmpl": "/dev/null",
        }

        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                info = ydl.extract_info(watch_url, download=False)
        except Exception as exc:  # noqa: BLE001 - yt-dlp raises many types
            raise ProviderError(
                "Could not resolve an audio stream. yt-dlp usually needs updating "
                f"when this happens. ({exc})"
            ) from exc

        if not isinstance(info, dict):
            raise ProviderError("yt-dlp returned no stream information")

        if info.get("is_live"):
            raise ProviderError("Live streams are not supported", retryable=False)

        chosen = self._pick_audio_format(info)
        if chosen is None:
            raise ProviderError("No audio-only format available for this track")

        url = chosen.get("url")
        if not url:
            raise ProviderError("Resolved stream has no URL")

        return StreamInfo(
            track_id=track_id,
            provider=self.id,
            url=url,
            mime_type=chosen.get("mime_type") or self._guess_mime(chosen),
            bitrate_kbps=_number(chosen.get("abr")) or _number(chosen.get("tbr")),
            codec=chosen.get("acodec"),
            expires_at=_expiry_from_url(url),
            resolved_at=datetime.now(timezone.utc),
        )

    @staticmethod
    def _pick_audio_format(info: dict) -> dict | None:
        formats: Iterable[dict] = info.get("formats") or []
        candidates = [
            fmt
            for fmt in formats
            if fmt.get("url")
            and fmt.get("acodec") not in (None, "none")
            and fmt.get("vcodec") in (None, "none")
        ]
        if not candidates and info.get("url") and info.get("acodec") not in (None, "none"):
            return info
        if not candidates:
            return None

        def score(fmt: dict) -> tuple[int, float]:
            mime = str(fmt.get("mime_type") or "")
            preference = next(
                (i for i, prefix in enumerate(_MIME_PREFERENCE) if mime.startswith(prefix)),
                len(_MIME_PREFERENCE),
            )
            quality = float(fmt.get("abr") or fmt.get("tbr") or 0)
            # Prefer m4a first, then the highest bitrate.
            return (-preference, quality)

        return max(candidates, key=score)

    @staticmethod
    def _guess_mime(fmt: dict) -> str | None:
        ext = fmt.get("ext")
        return {
            "m4a": "audio/mp4",
            "webm": "audio/webm",
            "opus": "audio/ogg",
            "mp3": "audio/mpeg",
        }.get(str(ext)) if ext else None

    # -- health ------------------------------------------------------------

    def _probe(self) -> None:
        self._call("health", self._client().get_search_suggestions, "music")

    def dependency_versions(self) -> DependencyVersions:
        def version(name: str) -> str | None:
            try:
                return importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError:
                return None

        yt_dlp_version = getattr(getattr(yt_dlp, "version", None), "__version__", None)
        return DependencyVersions(
            yt_dlp=version("yt-dlp") or yt_dlp_version,
            ytmusicapi=version("ytmusicapi"),
        )

    def _after_dependency_update(self) -> None:
        """Drop cached modules and clients so new code is picked up."""
        try:
            importlib.reload(yt_dlp)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not reload yt_dlp after update: %s", exc)
        with self._client_lock:
            self._generation += 1
