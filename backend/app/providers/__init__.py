"""Provider registry.

Only this module needs to change to add or swap a music source.
"""

from __future__ import annotations

import threading

from .. import config
from ..services.lyrics import LyricsService
from ..stream_cache import StreamCache
from .base import MusicProvider
from .youtube_music import YouTubeMusicProvider

__all__ = ["MusicProvider", "YouTubeMusicProvider", "get_provider", "shutdown_provider"]

_lock = threading.Lock()
_provider: MusicProvider | None = None
_lyrics_service: LyricsService | None = None

_FACTORIES = {
    "youtube_music": YouTubeMusicProvider,
}


def get_provider() -> MusicProvider:
    global _provider, _lyrics_service
    with _lock:
        if _provider is None:
            factory = _FACTORIES.get(config.PROVIDER)
            if factory is None:
                raise RuntimeError(
                    f"Unknown provider {config.PROVIDER!r}. "
                    f"Available: {', '.join(sorted(_FACTORIES))}"
                )
            _lyrics_service = LyricsService()
            _provider = factory(
                stream_cache=StreamCache(
                    ttl_seconds=config.STREAM_CACHE_TTL_SECONDS,
                    max_entries=config.STREAM_CACHE_MAX_ENTRIES,
                ),
                lyrics_service=_lyrics_service,
            )
        return _provider


def shutdown_provider() -> None:
    global _provider, _lyrics_service
    with _lock:
        if _provider is not None:
            _provider.close()
        if _lyrics_service is not None:
            _lyrics_service.close()
        _provider = None
        _lyrics_service = None
