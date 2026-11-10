"""Pydantic schemas for every HTTP payload.

The renderer mirrors these in ``src/api/types.ts``; keep both sides in sync when
adding fields.  Provider ids are opaque strings (YouTube browse ids / video ids)
so the UI never needs to know which provider produced them.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SearchFilter = Literal["all", "songs", "albums", "artists", "playlists"]


class ArtistRef(BaseModel):
    id: str | None = None
    name: str


class AlbumRef(BaseModel):
    id: str | None = None
    name: str


class Track(BaseModel):
    """A playable song. ``id`` is what ``/api/stream/{id}`` expects."""

    id: str
    provider: str = "youtube_music"
    title: str
    artists: list[ArtistRef] = Field(default_factory=list)
    album: AlbumRef | None = None
    duration: float | None = None
    thumbnail: str | None = None
    explicit: bool = False
    track_number: int | None = None


class AlbumSummary(BaseModel):
    id: str
    provider: str = "youtube_music"
    title: str
    artists: list[ArtistRef] = Field(default_factory=list)
    year: str | None = None
    thumbnail: str | None = None
    track_count: int | None = None
    kind: str = "album"


class AlbumDetail(AlbumSummary):
    description: str | None = None
    tracks: list[Track] = Field(default_factory=list)


class ArtistSummary(BaseModel):
    id: str
    provider: str = "youtube_music"
    name: str
    thumbnail: str | None = None
    subscribers: str | None = None


class ArtistDetail(ArtistSummary):
    description: str | None = None
    top_songs: list[Track] = Field(default_factory=list)
    albums: list[AlbumSummary] = Field(default_factory=list)
    singles: list[AlbumSummary] = Field(default_factory=list)


class PlaylistSummary(BaseModel):
    id: str
    provider: str = "youtube_music"
    title: str
    owner: str | None = None
    thumbnail: str | None = None
    track_count: int | None = None


class PlaylistDetail(PlaylistSummary):
    description: str | None = None
    tracks: list[Track] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Local library (SQLite)
# --------------------------------------------------------------------------


class LibraryPlaylistSummary(BaseModel):
    """A playlist owned by the local database.

    ``source`` is ``local`` for playlists built in the app and
    ``youtube_music`` for imported ones; ``source_id`` keeps the remote id so
    re-importing refreshes the same entry instead of duplicating it.
    """

    id: str
    name: str
    description: str | None = None
    source: str = "local"
    source_id: str | None = None
    source_url: str | None = None
    owner: str | None = None
    thumbnail: str | None = None
    track_count: int = 0
    created_at: datetime
    updated_at: datetime


class LibraryTrack(Track):
    """A stored track plus the row id needed to remove it from the playlist."""

    entry_id: int


class LibraryPlaylistDetail(LibraryPlaylistSummary):
    tracks: list[LibraryTrack] = Field(default_factory=list)


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class PlaylistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class PlaylistTracksAdd(BaseModel):
    tracks: list[Track] = Field(min_length=1, max_length=2000)


class PlaylistImport(BaseModel):
    """A playlist URL/id to import, from YouTube Music or Spotify."""

    url: str = Field(min_length=1, max_length=1000)


class SpotifyImportTrack(BaseModel):
    """A Spotify song that could not be matched to a playable track."""

    title: str
    artists: list[str] = Field(default_factory=list)


class SpotifyImportJob(BaseModel):
    """Progress of a background Spotify import.

    Matching every song is network-bound, so the import runs on its own thread
    and the Playlists page polls this shape until ``state`` leaves ``running``.
    """

    id: str
    state: Literal["running", "done", "error"]
    source_url: str
    name: str | None = None
    playlist_id: str | None = None
    total: int = 0
    completed: int = 0
    matched: int = 0
    skipped: list[SpotifyImportTrack] = Field(default_factory=list)
    error: str | None = None
    started_at: datetime
    finished_at: datetime | None = None



class SearchResults(BaseModel):
    query: str
    songs: list[Track] = Field(default_factory=list)
    albums: list[AlbumSummary] = Field(default_factory=list)
    artists: list[ArtistSummary] = Field(default_factory=list)
    playlists: list[PlaylistSummary] = Field(default_factory=list)


class StreamInfo(BaseModel):
    """A directly playable CDN URL plus the metadata the UI needs to trust it."""

    track_id: str
    provider: str
    url: str
    mime_type: str | None = None
    bitrate_kbps: float | None = None
    codec: str | None = None
    #: Wall-clock expiry reported by the CDN (may be absent).
    expires_at: datetime | None = None
    #: When this sidecar resolved the URL.
    resolved_at: datetime


class LyricWord(BaseModel):
    time: float
    text: str


class LyricLine(BaseModel):
    time: float
    text: str
    words: list[LyricWord] | None = None


class Lyrics(BaseModel):
    provider: str = "lrclib"
    synced: bool = False
    instrumental: bool = False
    lines: list[LyricLine] = Field(default_factory=list)
    plain: str | None = None
    source_url: str | None = None


class DependencyVersions(BaseModel):
    yt_dlp: str | None = None
    ytmusicapi: str | None = None


class ProviderHealth(BaseModel):
    provider: str
    ok: bool
    checked_at: datetime
    latency_ms: float | None = None
    error: str | None = None
    versions: DependencyVersions = Field(default_factory=DependencyVersions)


class HealthResponse(BaseModel):
    ok: bool
    service: str = "audifree-backend"
    version: str
    python_version: str
    uptime_seconds: float
    provider: ProviderHealth


class DependencyUpdateResult(BaseModel):
    ok: bool
    output: str
    versions: DependencyVersions
