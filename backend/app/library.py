"""The local library: playlists persisted in SQLite.

Everything here lives in ``AUDIFREE_DATA_DIR/library.db`` and is the only
stateful part of the app.  Track *metadata* is snapshotted so a playlist still
renders offline (and after a YouTube Music playlist is deleted upstream); the
audio itself is never stored, only resolved on demand by the provider.

The sidecar is threaded (FastAPI runs these blocking handlers in its threadpool)
so a single connection is shared under a lock.  Statements are tiny and the
database is local, so serialising is simpler than a pool.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from . import config
from .errors import BadRequestError, NotFoundError
from .models import (
    LibraryPlaylistDetail,
    LibraryPlaylistSummary,
    LibraryTrack,
    PlaylistDetail,
    Track,
)

log = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    source      TEXT NOT NULL DEFAULT 'local',
    source_id   TEXT,
    source_url  TEXT,
    owner       TEXT,
    thumbnail   TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    entry_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id  TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    track_id     TEXT NOT NULL,
    provider     TEXT NOT NULL,
    title        TEXT NOT NULL,
    artists      TEXT NOT NULL DEFAULT '[]',
    album_id     TEXT,
    album_name   TEXT,
    duration     REAL,
    thumbnail    TEXT,
    explicit     INTEGER NOT NULL DEFAULT 0,
    track_number INTEGER,
    added_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS playlist_tracks_order
    ON playlist_tracks(playlist_id, position);

-- One local copy per imported remote playlist; re-importing refreshes it.
CREATE UNIQUE INDEX IF NOT EXISTS playlists_source
    ON playlists(source, source_id) WHERE source_id IS NOT NULL;
"""

_URL_HINT_RE = re.compile(r"(youtube\.com|youtu\.be)", re.IGNORECASE)
_PLAYLIST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,120}$")
_PLAYLIST_PATH_RE = re.compile(r"/playlist/([A-Za-z0-9_-]+)")
# Search results and browse ids use the "VL"-prefixed browse form of a playlist
# (VLPL…); the canonical `list=` id is the part after VL.
_BROWSE_ID_PREFIX_RE = re.compile(r"^VL(?=(PL|OLA|RD|UU|LL|FL))")


def _canonical_playlist_id(playlist_id: str) -> str:
    return _BROWSE_ID_PREFIX_RE.sub("", playlist_id)

_SELECT_PLAYLIST = """
SELECT
    p.id,
    p.name,
    p.description,
    p.source,
    p.source_id,
    p.source_url,
    p.owner,
    p.created_at,
    p.updated_at,
    p.thumbnail,
    (
        SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id
    ) AS track_count,
    (
        SELECT t.thumbnail FROM playlist_tracks t
        WHERE t.playlist_id = p.id AND t.thumbnail IS NOT NULL
        ORDER BY t.position LIMIT 1
    ) AS first_thumbnail
FROM playlists p
"""

_SELECT_TRACK = """
SELECT entry_id, track_id, provider, title, artists, album_id, album_name,
       duration, thumbnail, explicit, track_number
FROM playlist_tracks
WHERE playlist_id = ?
ORDER BY position, entry_id
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _normalise_name(raw: str) -> str:
    name = " ".join(raw.split())
    if not name:
        raise BadRequestError("A playlist needs a name.")
    if len(name) > 120:
        raise BadRequestError("Playlist names are limited to 120 characters.")
    return name


def parse_playlist_reference(raw: str) -> tuple[str, str]:
    """Turn a pasted link or bare id into ``(playlist_id, canonical_url)``.

    Accepts ``music.youtube.com/playlist?list=...``, plain ``youtube.com``
    links, ``youtu.be`` links that carry ``?list=``, and bare ids such as
    ``PL...`` or ``OLAK5uy_...``.
    """
    text = raw.strip()
    if not text:
        raise BadRequestError("Paste a YouTube Music playlist link or id.")

    if text.startswith(("http://", "https://")) or _URL_HINT_RE.search(text):
        candidate = text if "://" in text else f"https://{text}"
        parsed = urlparse(candidate)
        values = parse_qs(parsed.query).get("list") or []
        playlist_id = values[0].strip() if values and values[0].strip() else ""
        if not playlist_id:
            match = _PLAYLIST_PATH_RE.search(parsed.path)
            playlist_id = match.group(1) if match else ""
        if not playlist_id:
            raise BadRequestError(
                "That link does not contain a playlist id (expected ?list=…)."
            )
    else:
        playlist_id = text

    if not _PLAYLIST_ID_RE.fullmatch(playlist_id):
        raise BadRequestError("That does not look like a YouTube Music playlist id.")

    playlist_id = _canonical_playlist_id(playlist_id)
    return playlist_id, f"https://music.youtube.com/playlist?list={playlist_id}"


class LibraryStore:
    """SQLite-backed local playlists."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()
        log.info("library database: %s", path)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # -- mapping -----------------------------------------------------------

    @staticmethod
    def _summary(row: sqlite3.Row) -> LibraryPlaylistSummary:
        return LibraryPlaylistSummary(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            source=row["source"],
            source_id=row["source_id"],
            source_url=row["source_url"],
            owner=row["owner"],
            thumbnail=row["thumbnail"] or row["first_thumbnail"],
            track_count=row["track_count"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    @staticmethod
    def _track(row: sqlite3.Row) -> LibraryTrack:
        try:
            artists = json.loads(row["artists"])
        except (TypeError, ValueError):
            artists = []
        return LibraryTrack(
            entry_id=row["entry_id"],
            id=row["track_id"],
            provider=row["provider"],
            title=row["title"],
            artists=artists,
            album=(
                {"id": row["album_id"], "name": row["album_name"]}
                if row["album_name"]
                else None
            ),
            duration=row["duration"],
            thumbnail=row["thumbnail"],
            explicit=bool(row["explicit"]),
            track_number=row["track_number"],
        )

    def _detail(self, playlist_id: str) -> LibraryPlaylistDetail:
        row = self._conn.execute(
            f"{_SELECT_PLAYLIST} WHERE p.id = ?", (playlist_id,)
        ).fetchone()
        if row is None:
            raise NotFoundError("Playlist not found")
        summary = self._summary(row)
        tracks = [
            self._track(entry) for entry in self._conn.execute(_SELECT_TRACK, (playlist_id,))
        ]
        return LibraryPlaylistDetail(**summary.model_dump(), tracks=tracks)

    # -- reads -------------------------------------------------------------

    def list_playlists(self) -> list[LibraryPlaylistSummary]:
        with self._lock:
            rows = self._conn.execute(
                f"{_SELECT_PLAYLIST} ORDER BY p.updated_at DESC, p.name COLLATE NOCASE"
            ).fetchall()
        return [self._summary(row) for row in rows]

    def get_playlist(self, playlist_id: str) -> LibraryPlaylistDetail:
        with self._lock:
            return self._detail(playlist_id)

    # -- writes ------------------------------------------------------------

    def create_playlist(self, name: str, description: str | None = None) -> LibraryPlaylistDetail:
        playlist_id = f"pl_{secrets.token_hex(8)}"
        timestamp = _now()
        clean_description = (description or "").strip() or None
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO playlists (id, name, description, source, created_at, updated_at)
                VALUES (?, ?, ?, 'local', ?, ?)
                """,
                (playlist_id, _normalise_name(name), clean_description, timestamp, timestamp),
            )
            self._conn.commit()
            return self._detail(playlist_id)

    def update_playlist(self, playlist_id: str, changes: dict[str, Any]) -> LibraryPlaylistDetail:
        allowed = {"name", "description"}
        updates = {key: value for key, value in changes.items() if key in allowed}
        if not updates:
            return self.get_playlist(playlist_id)

        assignments: list[str] = []
        values: list[Any] = []
        if "name" in updates:
            if updates["name"] is None:
                raise BadRequestError("A playlist needs a name.")
            assignments.append("name = ?")
            values.append(_normalise_name(str(updates["name"])))
        if "description" in updates:
            assignments.append("description = ?")
            values.append((updates["description"] or "").strip() or None)
        assignments.append("updated_at = ?")
        values.append(_now())

        with self._lock:
            cursor = self._conn.execute(
                f"UPDATE playlists SET {', '.join(assignments)} WHERE id = ?",
                (*values, playlist_id),
            )
            if cursor.rowcount == 0:
                raise NotFoundError("Playlist not found")
            self._conn.commit()
            return self._detail(playlist_id)

    def delete_playlist(self, playlist_id: str) -> None:
        with self._lock:
            cursor = self._conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
            if cursor.rowcount == 0:
                raise NotFoundError("Playlist not found")
            self._conn.commit()

    def add_tracks(self, playlist_id: str, tracks: list[Track]) -> LibraryPlaylistDetail:
        if not tracks:
            raise BadRequestError("No tracks to add.")
        with self._lock:
            exists = self._conn.execute(
                "SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)
            ).fetchone()
            if exists is None:
                raise NotFoundError("Playlist not found")

            start = self._conn.execute(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_tracks WHERE playlist_id = ?",
                (playlist_id,),
            ).fetchone()[0]
            timestamp = _now()
            self._conn.executemany(
                """
                INSERT INTO playlist_tracks (
                    playlist_id, position, track_id, provider, title, artists,
                    album_id, album_name, duration, thumbnail, explicit,
                    track_number, added_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        playlist_id,
                        start + offset,
                        track.id,
                        track.provider,
                        track.title,
                        json.dumps([artist.model_dump() for artist in track.artists]),
                        track.album.id if track.album else None,
                        track.album.name if track.album else None,
                        track.duration,
                        track.thumbnail,
                        int(track.explicit),
                        track.track_number,
                        timestamp,
                    )
                    for offset, track in enumerate(tracks)
                ],
            )
            self._conn.execute(
                "UPDATE playlists SET updated_at = ? WHERE id = ?", (timestamp, playlist_id)
            )
            self._conn.commit()
            return self._detail(playlist_id)

    def remove_track(self, playlist_id: str, entry_id: int) -> LibraryPlaylistDetail:
        with self._lock:
            cursor = self._conn.execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ? AND entry_id = ?",
                (playlist_id, entry_id),
            )
            if cursor.rowcount == 0:
                raise NotFoundError("Track is not in this playlist")
            # Keep positions dense so ordering survives future inserts.
            entries = self._conn.execute(
                "SELECT entry_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, entry_id",
                (playlist_id,),
            ).fetchall()
            self._conn.executemany(
                "UPDATE playlist_tracks SET position = ? WHERE entry_id = ?",
                [(index, row["entry_id"]) for index, row in enumerate(entries)],
            )
            self._conn.execute(
                "UPDATE playlists SET updated_at = ? WHERE id = ?", (_now(), playlist_id)
            )
            self._conn.commit()
            return self._detail(playlist_id)

    def import_playlist(
        self,
        remote: PlaylistDetail,
        *,
        source_id: str,
        source_url: str,
        source: str = "youtube_music",
    ) -> LibraryPlaylistDetail:
        """Store a catalogue playlist locally, refreshing it on re-import."""
        tracks = [track for track in remote.tracks if track.id]
        if not tracks:
            raise BadRequestError("That playlist has no playable tracks.")
        return self.import_tracks(
            name=remote.title,
            description=remote.description,
            owner=remote.owner,
            thumbnail=remote.thumbnail,
            tracks=tracks,
            source=source,
            source_id=source_id,
            source_url=source_url,
        )

    def import_tracks(
        self,
        *,
        name: str,
        description: str | None,
        owner: str | None,
        thumbnail: str | None,
        tracks: list[Track],
        source: str,
        source_id: str,
        source_url: str,
    ) -> LibraryPlaylistDetail:
        """Insert or replace an imported playlist and its track snapshot.

        Imported tracks are matched provider tracks (Spotify songs become
        playable YouTube Music tracks), so everything stored here streams
        through the same ``/api/stream`` path as catalogue songs.
        """
        if not tracks:
            raise BadRequestError("That playlist has no playable tracks.")

        timestamp = _now()
        with self._lock:
            row = self._conn.execute(
                "SELECT id FROM playlists WHERE source = ? AND source_id = ?",
                (source, source_id),
            ).fetchone()

            if row is None:
                playlist_id = f"pl_{secrets.token_hex(8)}"
                self._conn.execute(
                    """
                    INSERT INTO playlists (
                        id, name, description, source, source_id, source_url,
                        owner, thumbnail, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        playlist_id,
                        _normalise_name(name),
                        (description or "").strip() or None,
                        source,
                        source_id,
                        source_url,
                        owner,
                        thumbnail,
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                playlist_id = row["id"]
                self._conn.execute(
                    """
                    UPDATE playlists
                    SET name = ?, description = ?, source_url = ?, owner = ?,
                        thumbnail = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        _normalise_name(name),
                        (description or "").strip() or None,
                        source_url,
                        owner,
                        thumbnail,
                        timestamp,
                        playlist_id,
                    ),
                )
                self._conn.execute(
                    "DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,)
                )

            self._conn.executemany(
                """
                INSERT INTO playlist_tracks (
                    playlist_id, position, track_id, provider, title, artists,
                    album_id, album_name, duration, thumbnail, explicit,
                    track_number, added_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        playlist_id,
                        position,
                        track.id,
                        track.provider,
                        track.title,
                        json.dumps([artist.model_dump() for artist in track.artists]),
                        track.album.id if track.album else None,
                        track.album.name if track.album else None,
                        track.duration,
                        track.thumbnail,
                        int(track.explicit),
                        track.track_number,
                        timestamp,
                    )
                    for position, track in enumerate(tracks)
                ],
            )
            self._conn.commit()
            log.info("imported %s playlist %s (%d tracks)", source, source_id, len(tracks))
            return self._detail(playlist_id)


_lock = threading.Lock()
_store: LibraryStore | None = None


def get_library() -> LibraryStore:
    global _store
    with _lock:
        if _store is None:
            _store = LibraryStore(config.DATA_DIR / "library.db")
        return _store


def close_library() -> None:
    global _store
    with _lock:
        if _store is not None:
            _store.close()
        _store = None
