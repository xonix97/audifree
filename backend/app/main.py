"""FastAPI sidecar: the only process that talks to the network for metadata,
audio URLs and lyrics.

Endpoints are deliberately synchronous (``def``) so FastAPI runs the blocking
scraper calls in its threadpool instead of blocking the event loop.
"""

from __future__ import annotations

import logging
import platform
import secrets
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .errors import AppError
from .imports import get_job, start_spotify_import
from .library import close_library, get_library, parse_playlist_reference
from .models import (
    AlbumDetail,
    ArtistDetail,
    DependencyUpdateResult,
    HealthResponse,
    LibraryPlaylistDetail,
    LibraryPlaylistSummary,
    Lyrics,
    PlaylistCreate,
    PlaylistDetail,
    PlaylistImport,
    PlaylistTracksAdd,
    PlaylistUpdate,
    SearchFilter,
    SearchResults,
    SpotifyImportJob,
    StreamInfo,
)
from .providers import get_provider, shutdown_provider

log = logging.getLogger("audifree.backend")

_STARTED_AT = time.monotonic()

# Browse ids / playlist ids are URL-safe tokens from YouTube Music.
_ID_PATTERN = r"^[A-Za-z0-9_-]+$"


@asynccontextmanager
async def lifespan(_: FastAPI):
    provider = get_provider()
    log.info(
        "provider=%s versions=%s",
        provider.id,
        provider.dependency_versions().model_dump(),
    )
    log.info("data dir: %s", config.DATA_DIR)
    # Open the database at startup so a permissions problem fails loudly here
    # rather than on the first playlist request.
    get_library()
    yield
    shutdown_provider()
    close_library()


app = FastAPI(
    title="Audifree backend",
    version=config.VERSION,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600,
)


@app.middleware("http")
async def require_token(request: Request, call_next):
    """Reject any request that does not carry the token Electron generated.

    The port is random and bound to loopback, but a token stops other local
    processes (or a stray browser tab) from driving the sidecar.
    """
    if not config.TOKEN or request.method == "OPTIONS":
        return await call_next(request)

    header = request.headers.get("authorization", "")
    expected = f"Bearer {config.TOKEN}"
    if not secrets.compare_digest(header, expected):
        return JSONResponse(
            status_code=401,
            content={"detail": "Missing or invalid backend token", "code": "unauthorized"},
        )
    return await call_next(request)


@app.exception_handler(AppError)
async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": str(exc), "code": exc.code, "retryable": exc.retryable},
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled backend error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal backend error: {exc}", "code": "internal_error"},
    )


# --------------------------------------------------------------------------
# Health / maintenance
# --------------------------------------------------------------------------


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    provider_health = get_provider().health()
    return HealthResponse(
        ok=provider_health.ok,
        version=config.VERSION,
        python_version=platform.python_version(),
        uptime_seconds=round(time.monotonic() - _STARTED_AT, 1),
        provider=provider_health,
    )


@app.post("/api/health/update-deps", response_model=DependencyUpdateResult)
def update_dependencies() -> DependencyUpdateResult:
    """Upgrade yt-dlp / ytmusicapi inside the app venv (blocking, up to 10 min)."""
    return get_provider().update_dependencies()


# --------------------------------------------------------------------------
# Catalog
# --------------------------------------------------------------------------


@app.get("/api/search", response_model=SearchResults)
def search(
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    filter: SearchFilter = Query("all", alias="filter"),
    limit: int = Query(20, ge=1, le=50),
) -> SearchResults:
    return get_provider().search(q, filter=filter, limit=limit)


@app.get("/api/albums/{album_id}", response_model=AlbumDetail)
def get_album(
    album_id: str = Path(..., pattern=_ID_PATTERN, min_length=2, max_length=128),
) -> AlbumDetail:
    return get_provider().get_album(album_id)


@app.get("/api/artists/{artist_id}", response_model=ArtistDetail)
def get_artist(
    artist_id: str = Path(..., pattern=_ID_PATTERN, min_length=2, max_length=128),
) -> ArtistDetail:
    return get_provider().get_artist(artist_id)


@app.get("/api/playlists/{playlist_id}", response_model=PlaylistDetail)
def get_playlist(
    playlist_id: str = Path(..., pattern=_ID_PATTERN, min_length=2, max_length=128),
) -> PlaylistDetail:
    return get_provider().get_playlist(playlist_id)


# --------------------------------------------------------------------------
# Local library (SQLite): playlists + YouTube Music import
# --------------------------------------------------------------------------


@app.get("/api/library/playlists", response_model=list[LibraryPlaylistSummary])
def list_library_playlists() -> list[LibraryPlaylistSummary]:
    return get_library().list_playlists()


@app.post(
    "/api/library/playlists",
    response_model=LibraryPlaylistDetail,
    status_code=201,
)
def create_library_playlist(payload: PlaylistCreate) -> LibraryPlaylistDetail:
    return get_library().create_playlist(payload.name, payload.description)


@app.post("/api/library/import", response_model=LibraryPlaylistDetail)
def import_library_playlist(payload: PlaylistImport) -> LibraryPlaylistDetail:
    """Fetch a public YouTube Music playlist and store a local snapshot.

    Importing the same playlist again refreshes the existing entry (same
    ``source_id``) rather than creating a duplicate.
    """
    source_id, source_url = parse_playlist_reference(payload.url)
    remote = get_provider().get_playlist(source_id)
    return get_library().import_playlist(
        remote, source_id=source_id, source_url=source_url
    )


@app.post(
    "/api/library/import/spotify",
    response_model=SpotifyImportJob,
    status_code=202,
)
def import_spotify_playlist(payload: PlaylistImport) -> SpotifyImportJob:
    """Start matching a public Spotify playlist to playable tracks.

    The playlist is read from Spotify's public embed page, so no account or API
    credentials are involved.  Matching is one search per song, so this returns
    a job immediately; the renderer polls
    ``GET /api/library/import/spotify/{job_id}`` for progress.  Re-importing the
    same playlist refreshes the existing local entry.
    """
    return start_spotify_import(payload.url)


@app.get(
    "/api/library/import/spotify/{job_id}", response_model=SpotifyImportJob
)
def spotify_import_job(
    job_id: str = Path(..., pattern=_ID_PATTERN, min_length=2, max_length=64),
) -> SpotifyImportJob:
    return get_job(job_id)


@app.get(
    "/api/library/playlists/{playlist_id}", response_model=LibraryPlaylistDetail
)
def get_library_playlist(
    playlist_id: str = Path(..., pattern=_ID_PATTERN, min_length=2, max_length=128),
) -> LibraryPlaylistDetail:
    return get_library().get_playlist(playlist_id)


@app.patch(
    "/api/library/playlists/{playlist_id}", response_model=LibraryPlaylistDetail
)
def update_library_playlist(
    payload: PlaylistUpdate,
    playlist_id: str = Path(..., pattern=_ID_PATTERN, min_length=2, max_length=128),
) -> LibraryPlaylistDetail:
    return get_library().update_playlist(
        playlist_id, payload.model_dump(exclude_unset=True)
    )


@app.delete("/api/library/playlists/{playlist_id}")
def delete_library_playlist(
    playlist_id: str = Path(..., pattern=_ID_PATTERN, min_length=2, max_length=128),
) -> dict[str, bool]:
    get_library().delete_playlist(playlist_id)
    return {"ok": True}


@app.post(
    "/api/library/playlists/{playlist_id}/tracks",
    response_model=LibraryPlaylistDetail,
)
def add_library_playlist_tracks(
    payload: PlaylistTracksAdd,
    playlist_id: str = Path(..., pattern=_ID_PATTERN, min_length=2, max_length=128),
) -> LibraryPlaylistDetail:
    return get_library().add_tracks(playlist_id, payload.tracks)


@app.delete(
    "/api/library/playlists/{playlist_id}/tracks/{entry_id}",
    response_model=LibraryPlaylistDetail,
)
def remove_library_playlist_track(
    playlist_id: str = Path(..., pattern=_ID_PATTERN, min_length=2, max_length=128),
    entry_id: int = Path(..., ge=1),
) -> LibraryPlaylistDetail:
    return get_library().remove_track(playlist_id, entry_id)


# --------------------------------------------------------------------------
# Playback + lyrics
# --------------------------------------------------------------------------


@app.get("/api/stream/{track_id}", response_model=StreamInfo)
def get_stream(
    track_id: str = Path(..., pattern=r"^[A-Za-z0-9_-]{6,32}$"),
    refresh: bool = Query(
        False,
        description="Force re-resolution (used when the CDN URL has expired)",
    ),
) -> StreamInfo:
    return get_provider().get_stream(track_id, force_refresh=refresh)


@app.get("/api/lyrics", response_model=Lyrics | None)
def get_lyrics(
    title: str = Query(..., min_length=1, max_length=300),
    artist: str = Query(..., min_length=1, max_length=300),
    album: str | None = Query(None, max_length=300),
    duration: float | None = Query(None, ge=0, le=60 * 60 * 24),
) -> Lyrics | None:
    return get_provider().get_lyrics(
        title=title, artist=artist, album=album, duration=duration
    )


def run() -> None:
    """Entry point used by Electron (``python -m app.main``)."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    if not config.TOKEN:
        log.warning(
            "AUDIFREE_TOKEN is not set - the API is unauthenticated. "
            "This is fine for local development only."
        )

    port = config.PORT or 8787
    log.info("starting on http://%s:%s", config.HOST, port)
    uvicorn.run(
        app,
        host=config.HOST,
        port=port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    run()
