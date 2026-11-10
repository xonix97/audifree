"""Audifree Python sidecar.

The desktop app spawns this package with ``python -m app.main`` on a random
localhost port.  It owns everything that talks to the outside world:

* metadata search / browse through a :class:`MusicProvider`
* stream URL resolution (yt-dlp) with a short-lived cache
* synced lyrics (LRCLIB)

No audio is ever written to disk by this service: yt-dlp runs with
``download=False`` and only a signed CDN URL is handed to the renderer.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
