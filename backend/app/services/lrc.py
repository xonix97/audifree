"""LRC (synced lyrics) parsing.

Handles the shapes LRCLIB actually returns:

* plain LRC: ``[00:12.34]line``
* multiple timestamps per line: ``[00:12.34][01:02.00]line``
* enhanced LRC word tags: ``[00:12.34]<00:12.34>Hello <00:12.90>world``
* metadata tags (``[ar:]``, ``[offset:]``, ...)

Timestamps are converted to seconds relative to the start of the track.  A
positive ``[offset:]`` shifts lyrics later, which is how most players interpret
the tag.
"""

from __future__ import annotations

import re

from ..models import LyricLine, LyricWord

_LINE_TAG = re.compile(r"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]")
_WORD_TAG = re.compile(r"<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>")
_META_TAG = re.compile(r"^\[([a-zA-Z]+):(.*)\]$")


def _to_seconds(minutes: str, seconds: str, fraction: str | None) -> float:
    value = int(minutes) * 60 + int(seconds)
    if fraction:
        # 1 digit = tenths, 2 = centiseconds, 3 = milliseconds
        value += int(fraction) / (10 ** len(fraction))
    return float(value)


def _node_time(match: re.Match[str]) -> float:
    return _to_seconds(match.group(1), match.group(2), match.group(3))


def _parse_words(text: str, fallback_start: float) -> tuple[str, list[LyricWord] | None]:
    """Split enhanced LRC word tags out of a line.

    Returns the plain text plus ``None`` when the line has no word timing.
    """
    matches = list(_WORD_TAG.finditer(text))
    if not matches:
        return text.strip(), None

    words: list[LyricWord] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        chunk = text[start:end]
        if chunk.strip():
            words.append(LyricWord(time=_node_time(match), text=chunk.strip()))

    plain = _WORD_TAG.sub("", text).strip()
    if not words:
        return plain, None
    # A line whose first word starts before the line timestamp is malformed;
    # clamp so highlighting never runs backwards.
    if words[0].time < fallback_start:
        words[0].time = fallback_start
    return plain, words


def parse_lrc(raw: str, *, offset_ms: int = 0) -> list[LyricLine]:
    """Parse an LRC document into sorted, deduplicated lines."""
    lines: list[LyricLine] = []
    detected_offset = offset_ms

    for raw_line in raw.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue

        meta = _META_TAG.match(stripped)
        if meta:
            key, value = meta.group(1).lower(), meta.group(2).strip()
            if key == "offset":
                try:
                    detected_offset = int(value)
                except ValueError:
                    pass
            continue

        stamps = list(_LINE_TAG.finditer(stripped))
        if not stamps:
            continue

        text = stripped[stamps[-1].end() :]
        plain, words = _parse_words(text, _node_time(stamps[0]))
        for stamp in stamps:
            lines.append(
                LyricLine(time=_node_time(stamp), text=plain, words=words)
            )

    shift = detected_offset / 1000.0
    if shift:
        for line in lines:
            line.time = max(0.0, line.time + shift)
            if line.words:
                for word in line.words:
                    word.time = max(0.0, word.time + shift)

    # Stable sort keeps duplicate timestamps in document order.
    lines.sort(key=lambda line: line.time)

    deduped: list[LyricLine] = []
    for line in lines:
        if deduped and line.time == deduped[-1].time and line.text == deduped[-1].text:
            continue
        deduped.append(line)
    return deduped
