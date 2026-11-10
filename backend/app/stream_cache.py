"""Short-lived cache for resolved stream URLs.

YouTube CDN URLs are signed and expire, so we deliberately keep this cache in
process memory only and never persist it.  Resolution happens right before
playback; a cached entry is reused for ~50 minutes.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict

from .models import StreamInfo


class StreamCache:
    def __init__(self, *, ttl_seconds: float, max_entries: int = 200) -> None:
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._lock = threading.Lock()
        # track_id -> (expires_at_monotonic, stream)
        self._entries: OrderedDict[str, tuple[float, StreamInfo]] = OrderedDict()

    def get(self, track_id: str) -> StreamInfo | None:
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(track_id)
            if entry is None:
                return None
            expires_at, stream = entry
            if expires_at <= now:
                self._entries.pop(track_id, None)
                return None
            # LRU touch
            self._entries.move_to_end(track_id)
            return stream

    def set(self, track_id: str, stream: StreamInfo) -> None:
        expires_at = time.monotonic() + self._ttl
        with self._lock:
            self._entries[track_id] = (expires_at, stream)
            self._entries.move_to_end(track_id)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)

    def invalidate(self, track_id: str | None = None) -> None:
        with self._lock:
            if track_id is None:
                self._entries.clear()
            else:
                self._entries.pop(track_id, None)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)
