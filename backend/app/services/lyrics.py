"""LRCLIB client.

LRCLIB (https://lrclib.net) is a free, community-run lyrics database.  We first
ask for an exact match (artist + title + album + duration), then fall back to a
search and take the best-scoring result.  Only synced/plain data is passed on;
nothing is written to disk.
"""

from __future__ import annotations

import difflib
import logging

import httpx

from .. import config
from ..models import Lyrics
from .lrc import parse_lrc

log = logging.getLogger(__name__)


def _normalise(value: str | None) -> str:
    return " ".join((value or "").lower().replace("’", "'").split())


class LyricsService:
    def __init__(self, base_url: str = config.LRCLIB_BASE_URL) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            timeout=httpx.Timeout(10.0, connect=5.0),
            headers={
                "User-Agent": config.USER_AGENT,
                "Accept": "application/json",
            },
            follow_redirects=True,
        )

    def close(self) -> None:
        self._client.close()

    def get(
        self,
        *,
        title: str,
        artist: str,
        album: str | None = None,
        duration: float | None = None,
    ) -> Lyrics | None:
        if not title.strip() or not artist.strip():
            return None

        record = self._exact_match(title, artist, album, duration)
        if record is None:
            record = self._search(title, artist, duration)
        if record is None:
            return None

        return self._to_lyrics(record)

    # -- internals ---------------------------------------------------------

    def _exact_match(
        self,
        title: str,
        artist: str,
        album: str | None,
        duration: float | None,
    ) -> dict | None:
        params: dict[str, str | int] = {
            "track_name": title,
            "artist_name": artist,
        }
        if album:
            params["album_name"] = album
        if duration:
            params["duration"] = int(round(duration))
        try:
            response = self._client.get(f"{self._base_url}/get", params=params)
        except httpx.HTTPError as exc:
            log.warning("LRCLIB exact lookup failed: %s", exc)
            return None

        if response.status_code == 404:
            return None
        if response.status_code != 200:
            log.info("LRCLIB exact lookup returned %s", response.status_code)
            return None
        try:
            return response.json()
        except ValueError:
            return None

    def _search(self, title: str, artist: str, duration: float | None) -> dict | None:
        params = {"track_name": title, "artist_name": artist}
        try:
            response = self._client.get(f"{self._base_url}/search", params=params)
            if response.status_code != 200:
                return None
            candidates = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("LRCLIB search failed: %s", exc)
            return None

        if not isinstance(candidates, list) or not candidates:
            return None

        wanted_title = _normalise(title)
        wanted_artist = _normalise(artist)

        def score(record: dict) -> float:
            title_score = difflib.SequenceMatcher(
                None, wanted_title, _normalise(record.get("trackName"))
            ).ratio()
            artist_score = difflib.SequenceMatcher(
                None, wanted_artist, _normalise(record.get("artistName"))
            ).ratio()
            bonus = 0.15 if record.get("syncedLyrics") else 0.0
            if duration and record.get("duration"):
                drift = abs(float(record["duration"]) - duration)
                bonus += max(0.0, 0.15 - drift / 60.0)
            return title_score * 0.6 + artist_score * 0.4 + bonus

        best = max(candidates, key=score)
        # Reject wildly unrelated results so the UI can show "no lyrics".
        return best if score(best) >= 0.45 else None

    def _to_lyrics(self, record: dict) -> Lyrics | None:
        synced_raw = (record.get("syncedLyrics") or "").strip()
        plain = (record.get("plainLyrics") or "").strip() or None
        instrumental = bool(record.get("instrumental"))

        lines = parse_lrc(synced_raw) if synced_raw else []
        if lines:
            return Lyrics(
                synced=True,
                instrumental=instrumental,
                lines=lines,
                plain=plain,
                source_url=self._record_url(record),
            )
        if plain:
            return Lyrics(
                synced=False,
                instrumental=instrumental,
                lines=[],
                plain=plain,
                source_url=self._record_url(record),
            )
        if instrumental:
            return Lyrics(instrumental=True, synced=False, lines=[], plain=None)
        return None

    def _record_url(self, record: dict) -> str | None:
        record_id = record.get("id")
        return f"https://lrclib.net/lyrics/{record_id}" if record_id else None
