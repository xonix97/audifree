"""Background playlist imports: Spotify song lists become playable local playlists.

Spotify gives us titles and artists, not audio.  Every Spotify song is therefore
searched against the music provider and the best candidate is kept, so the
imported playlist contains ordinary streamable tracks.

Matching is the slow part (one search per song, ~0.3-1 s), so it runs
concurrently across a bounded worker pool and reports progress.  Each worker
uses the provider's own thread-local client, which is why the provider is safe
to call from several threads.  Jobs live in memory only; they are progress
records, not library data.
"""

from __future__ import annotations

import logging
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from difflib import SequenceMatcher

from . import config
from .errors import BadRequestError, NotFoundError, ProviderError
from .library import get_library
from .models import SpotifyImportJob, SpotifyImportTrack, Track
from .providers import get_provider
from .spotify import SpotifyTrackRef, fetch_playlist, parse_spotify_reference

log = logging.getLogger(__name__)

#: Finished jobs kept around so a late poll still gets its result.
_MAX_JOBS = 20
_JOB_TTL_SECONDS = 60 * 60

_jobs: dict[str, SpotifyImportJob] = {}
_order: list[str] = []
_lock = threading.Lock()

_FEATURING_RE = re.compile(r"\b(feat|feat\.|ft|ft\.|featuring)\s.+$")
_BRACKETS_RE = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_DASH_SUFFIX_RE = re.compile(r"\s[-–—]\s.*$")
_NON_WORD_RE = re.compile(r"[^a-z0-9]+")


def _normalise(text: str) -> str:
    """Fold a title/artist down to comparable words.

    Drops bracketed qualifiers ("(feat. …)", "[Live]"), a " - Remastered 2011"
    suffix and punctuation, so "Get Lucky (Radio Edit)" and "Get Lucky" agree.
    """
    folded = text.lower()
    folded = _BRACKETS_RE.sub(" ", folded)
    folded = _FEATURING_RE.sub(" ", folded)
    folded = _DASH_SUFFIX_RE.sub(" ", folded)
    folded = folded.replace("&", " and ")
    folded = _NON_WORD_RE.sub(" ", folded)
    return " ".join(folded.split())


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    # Short names inside longer ones ("Daft Punk" vs "Daft Punk feat. …")
    # should not be punished by the ratio.
    if left in right or right in left:
        return 0.95
    return SequenceMatcher(None, left, right).ratio()


def choose_match(
    candidates: list[Track],
    *,
    title: str,
    artists: list[str],
    duration: float | None,
) -> Track | None:
    """Pick the provider track that best represents a Spotify song.

    A candidate must look like the same song (title) and, unless the title is
    near-identical, share an artist.  Durations disambiguate live/remix takes:
    anything more than 25 s off is rejected outright.
    """
    wanted_title = _normalise(title)
    wanted_artists = [name for name in (_normalise(a) for a in artists) if name]
    if not wanted_title:
        return None

    best: Track | None = None
    best_score = 0.0

    for candidate in candidates:
        candidate_title = _normalise(candidate.title)
        title_ratio = _similarity(wanted_title, candidate_title)
        if title_ratio < 0.72:
            continue

        artist_ratio = 0.0
        for candidate_artist in candidate.artists:
            name = _normalise(candidate_artist.name)
            if not name:
                continue
            if wanted_artists:
                artist_ratio = max(
                    artist_ratio, max(_similarity(name, wanted) for wanted in wanted_artists)
                )
            else:
                artist_ratio = max(artist_ratio, 0.5)
        if artist_ratio < 0.45 and title_ratio < 0.9:
            continue

        duration_bonus = 0.0
        if duration and candidate.duration:
            delta = abs(candidate.duration - duration)
            if delta > 25:
                continue
            duration_bonus = 1.2 if delta <= 3 else 0.8 if delta <= 8 else 0.2

        score = title_ratio * 3.0 + artist_ratio * 1.5 + duration_bonus
        if score > best_score:
            best, best_score = candidate, score

    return best if best_score >= 2.9 else None


def _match_one(provider, entry: SpotifyTrackRef) -> Track | None:
    query = " ".join(part for part in [entry.title, *entry.artists[:2]] if part).strip()
    for attempt in (1, 2):
        try:
            results = provider.search(query, filter="songs", limit=8)
            return choose_match(
                results.songs,
                title=entry.title,
                artists=entry.artists,
                duration=entry.duration,
            )
        except ProviderError:
            if attempt == 2:
                raise
            # ytmusicapi occasionally answers a burst of parallel searches with
            # a transient failure; one short retry per song keeps the import
            # from losing tracks to noise.
            time.sleep(0.4)
    return None


def match_tracks(
    entries: list[SpotifyTrackRef],
    *,
    on_progress,
) -> tuple[list[Track | None], list[SpotifyTrackRef]]:
    """Match every Spotify song concurrently, preserving playlist order."""
    provider = get_provider()
    results: list[Track | None] = [None] * len(entries)
    failures: list[SpotifyTrackRef] = []
    failures_lock = threading.Lock()

    def worker(index: int, entry: SpotifyTrackRef) -> None:
        try:
            results[index] = _match_one(provider, entry)
        except Exception as exc:  # noqa: BLE001 - one bad song must not kill the import
            log.warning("matching %r failed: %s", entry.title, exc)
            results[index] = None
        if results[index] is None:
            with failures_lock:
                failures.append(entry)
        on_progress(results[index] is not None)

    with ThreadPoolExecutor(
        max_workers=min(config.IMPORT_WORKERS, max(1, len(entries))),
        thread_name_prefix="spotify-match",
    ) as pool:
        futures = [pool.submit(worker, index, entry) for index, entry in enumerate(entries)]
        for future in as_completed(futures):
            # Surface unexpected executor errors instead of hanging the job.
            future.result()

    return results, failures


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _update(job_id: str, **fields) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        for key, value in fields.items():
            setattr(job, key, value)


def _prune() -> None:
    cutoff = _now().timestamp() - _JOB_TTL_SECONDS
    for job_id in list(_order):
        job = _jobs.get(job_id)
        if job is None:
            _order.remove(job_id)
        elif job.state != "running" and job.finished_at and job.finished_at.timestamp() < cutoff:
            _order.remove(job_id)
            _jobs.pop(job_id, None)

    # Never evict a running job, even when a burst of imports exceeds the cap.
    while len(_order) > _MAX_JOBS:
        victim = next((jid for jid in _order if _jobs[jid].state != "running"), None)
        if victim is None:
            break
        _order.remove(victim)
        _jobs.pop(victim, None)


def get_job(job_id: str) -> SpotifyImportJob:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise NotFoundError("Import job not found")
        return job.model_copy(deep=True)


def _run_job(job_id: str, playlist_id: str, source_url: str) -> None:
    try:
        remote = fetch_playlist(playlist_id)

        if not remote.tracks:
            raise BadRequestError(
                "That Spotify playlist has no songs to import (only episodes or "
                "unavailable tracks)."
            )

        _update(job_id, name=remote.name, total=len(remote.tracks))

        def progress(matched: bool) -> None:
            with _lock:
                job = _jobs.get(job_id)
                if job is None:
                    return
                job.completed += 1
                if matched:
                    job.matched += 1

        results, unmatched = match_tracks(remote.tracks, on_progress=progress)
        matched = [track for track in results if track is not None]

        skipped = [
            SpotifyImportTrack(title=entry.title, artists=entry.artists)
            for entry in unmatched
        ]

        if not matched:
            raise BadRequestError(
                "None of those songs could be found on YouTube Music. "
                "Check the playlist is public and not region-locked."
            )

        detail = get_library().import_tracks(
            name=remote.name,
            description=remote.description,
            owner=remote.owner,
            thumbnail=remote.thumbnail,
            tracks=matched,
            source="spotify",
            source_id=playlist_id,
            source_url=source_url,
        )

        _update(
            job_id,
            state="done",
            playlist_id=detail.id,
            matched=len(matched),
            skipped=skipped,
            completed=len(remote.tracks),
        )
        log.info(
            "spotify import %s: %d/%d songs matched",
            playlist_id,
            len(matched),
            len(remote.tracks),
        )
    except Exception as exc:  # noqa: BLE001 - reported through the job
        log.warning("spotify import %s failed: %s", playlist_id, exc)
        _update(job_id, state="error", error=str(exc) or exc.__class__.__name__)
    finally:
        _update(job_id, finished_at=_now())


def start_spotify_import(raw_url: str) -> SpotifyImportJob:
    """Validate the link, then match/store the playlist on a background thread."""
    playlist_id, source_url = parse_spotify_reference(raw_url)

    job = SpotifyImportJob(
        id=f"job_{secrets.token_hex(6)}",
        state="running",
        source_url=source_url,
        started_at=_now(),
    )
    with _lock:
        _order.append(job.id)
        _jobs[job.id] = job
        _prune()

    thread = threading.Thread(
        target=_run_job,
        args=(job.id, playlist_id, source_url),
        name=f"spotify-import-{job.id}",
        daemon=True,
    )
    thread.start()
    return get_job(job.id)
