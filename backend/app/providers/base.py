"""The provider contract plus behaviour every provider inherits.

Adding a new music source (JioSaavn, a lossless engine, ...) means:

1. subclass :class:`MusicProvider`
2. implement the abstract methods in its own module
3. register it in ``providers/__init__.py``

The UI and the HTTP layer only speak to this interface.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import threading
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone

from ..models import (
    AlbumDetail,
    ArtistDetail,
    DependencyUpdateResult,
    DependencyVersions,
    Lyrics,
    PlaylistDetail,
    ProviderHealth,
    SearchFilter,
    SearchResults,
    StreamInfo,
)
from ..services.lyrics import LyricsService
from ..stream_cache import StreamCache

log = logging.getLogger(__name__)

#: How long a health probe result is reused before probing again.
HEALTH_TTL_SECONDS = 60.0


class MusicProvider(ABC):
    #: Stable identifier persisted with library entries.
    id: str = "base"
    display_name: str = "Base provider"
    #: Packages the "Update dependencies" button upgrades inside the venv.
    dependency_packages: tuple[str, ...] = ()
    #: False for sources that ship no lyrics.
    supports_lyrics: bool = True

    def __init__(self, *, stream_cache: StreamCache, lyrics_service: LyricsService) -> None:
        self._cache = stream_cache
        self._lyrics = lyrics_service
        self._health_lock = threading.Lock()
        self._last_health: ProviderHealth | None = None

    # -- metadata ----------------------------------------------------------

    @abstractmethod
    def search(
        self, query: str, *, filter: SearchFilter = "all", limit: int = 20
    ) -> SearchResults: ...

    @abstractmethod
    def get_album(self, album_id: str) -> AlbumDetail: ...

    @abstractmethod
    def get_artist(self, artist_id: str) -> ArtistDetail: ...

    @abstractmethod
    def get_playlist(self, playlist_id: str) -> PlaylistDetail: ...

    # -- playback ----------------------------------------------------------

    @abstractmethod
    def _resolve_stream(self, track_id: str) -> StreamInfo:
        """Turn a track id into a directly playable, expiring URL."""

    def get_stream(self, track_id: str, *, force_refresh: bool = False) -> StreamInfo:
        """Return a cached stream URL, resolving one only when necessary.

        ``force_refresh`` is used by the renderer when the media element fails
        (typically a 403 from the CDN), which also evicts the stale entry.
        """
        if not force_refresh:
            cached = self._cache.get(track_id)
            if cached is not None:
                return cached

        started = time.monotonic()
        stream = self._resolve_stream(track_id)
        self._cache.set(track_id, stream)
        log.info(
            "resolved stream %s in %.0f ms",
            track_id,
            (time.monotonic() - started) * 1000,
        )
        return stream

    # -- lyrics ------------------------------------------------------------

    def get_lyrics(
        self,
        *,
        title: str,
        artist: str,
        album: str | None = None,
        duration: float | None = None,
    ) -> Lyrics | None:
        if not self.supports_lyrics:
            return None
        return self._lyrics.get(title=title, artist=artist, album=album, duration=duration)

    # -- health ------------------------------------------------------------

    @abstractmethod
    def _probe(self) -> None:
        """Perform the cheapest possible live request; raise on failure."""

    @abstractmethod
    def dependency_versions(self) -> DependencyVersions:
        """Versions of the scraper packages, for the update banner."""

    def health(self, *, force: bool = False) -> ProviderHealth:
        with self._health_lock:
            last = self._last_health
            if (
                not force
                and last is not None
                and (datetime.now(timezone.utc) - last.checked_at).total_seconds()
                < HEALTH_TTL_SECONDS
            ):
                return last

            started = time.monotonic()
            error: str | None = None
            try:
                self._probe()
            except Exception as exc:  # noqa: BLE001 - surfaced to the UI
                log.warning("provider health probe failed: %s", exc)
                error = str(exc) or exc.__class__.__name__

            health = ProviderHealth(
                provider=self.id,
                ok=error is None,
                checked_at=datetime.now(timezone.utc),
                latency_ms=round((time.monotonic() - started) * 1000, 1),
                error=error,
                versions=self.dependency_versions(),
            )
            self._last_health = health
            return health

    def invalidate_health(self) -> None:
        with self._health_lock:
            self._last_health = None

    # -- maintenance -------------------------------------------------------

    def update_dependencies(self) -> DependencyUpdateResult:
        """``pip install -U`` the scraper packages inside the running venv.

        This is what the in-app "Update yt-dlp" button calls when YouTube
        changes something and resolution starts failing.
        """
        packages = list(self.dependency_packages)
        if not packages:
            return DependencyUpdateResult(
                ok=True, output="This provider has no updatable dependencies.", versions=self.dependency_versions()
            )

        command = [sys.executable, "-m", "pip", "install", "--upgrade", *packages]
        log.info("updating dependencies: %s", " ".join(command))
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=600,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return DependencyUpdateResult(
                ok=False, output=f"{exc.__class__.__name__}: {exc}", versions=self.dependency_versions()
            )

        output = (completed.stdout or "") + (completed.stderr or "")
        output = output.strip()[-4000:]
        ok = completed.returncode == 0

        if ok:
            # Reload in place so the new code is used without a restart where
            # possible; a restart is still the most reliable option.
            self._after_dependency_update()
            self.invalidate_health()

        return DependencyUpdateResult(ok=ok, output=output, versions=self.dependency_versions())

    def _after_dependency_update(self) -> None:
        """Hook for providers that cache imported modules or clients."""

    def close(self) -> None:
        """Release network resources. Called on sidecar shutdown."""
