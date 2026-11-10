/**
 * LRCLIB lyrics with line- and word-synced highlighting.
 *
 * Playback position is read from the audio element on a short interval (not the
 * 4 Hz `timeupdate`), which keeps word highlighting smooth without re-rendering
 * the whole player 60 times a second.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useApi } from '../api/useApi'
import type { Lyrics, Track } from '../api/types'
import { usePlayer } from '../player/PlayerProvider'
import { GlassPanel } from './GlassPanel'

interface LyricsPanelProps {
  track: Track
  open: boolean
}

const CLOCK_INTERVAL_MS = 80
const LINE_LEAD_SECONDS = 0.2

function usePlaybackClock(getPosition: () => number, active: boolean): number {
  const [time, setTime] = useState(() => getPosition())

  useEffect(() => {
    if (!active) return
    setTime(getPosition())
    const timer = window.setInterval(() => setTime(getPosition()), CLOCK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [active, getPosition])

  return time
}

function findLineIndex(times: number[], clock: number): number {
  let active = -1
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index]
    if (time !== undefined && time <= clock + LINE_LEAD_SECONDS) active = index
    else break
  }
  return active
}

function findWordIndex(times: (number | undefined)[], clock: number): number {
  let active = -1
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index]
    if (time !== undefined && time <= clock + 0.05) active = index
    else break
  }
  return active
}

export function LyricsPanel({ track, open }: LyricsPanelProps) {
  const { getPosition } = usePlayer()
  const reduceMotion = useReducedMotion()
  const artist = track.artists[0]?.name ?? ''

  const { data, loading, error } = useApi<Lyrics | null>(open ? '/api/lyrics' : null, {
    title: track.title,
    artist,
    album: track.album?.name ?? undefined,
    duration: track.duration ? Math.round(track.duration) : undefined,
  })

  const syncedLines = data?.synced ? data.lines : []
  const lineTimes = useMemo(() => syncedLines.map((line) => line.time), [syncedLines])
  const clock = usePlaybackClock(getPosition, open && syncedLines.length > 0)
  const activeIndex = syncedLines.length > 0 ? findLineIndex(lineTimes, clock) : -1

  const activeLine = activeIndex >= 0 ? syncedLines[activeIndex] : undefined
  const wordTimes = useMemo(
    () => (activeLine?.words ?? []).map((word) => word.time),
    [activeLine],
  )
  const activeWord = wordTimes.length > 0 ? findWordIndex(wordTimes, clock) : -1

  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([])

  useEffect(() => {
    if (activeIndex < 0) return
    const node = lineRefs.current[activeIndex]
    node?.scrollIntoView({
      block: 'center',
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }, [activeIndex, reduceMotion])

  return (
    <GlassPanel className="lyrics" tone="subtle" aria-label="Lyrics">
      <header className="lyrics__header">
        <h2 className="lyrics__title">Lyrics</h2>
        {data?.synced && <span className="lyrics__badge">Synced</span>}
      </header>

      <div className="lyrics__scroll">
        {loading && (
          <div className="lyrics__status">
            <span className="spinner__ring" aria-hidden="true" />
            <span>Finding lyrics…</span>
          </div>
        )}

        {!loading && error && (
          <p className="lyrics__status">Lyrics aren’t available right now.</p>
        )}

        {!loading && !error && !data && (
          <p className="lyrics__status">No lyrics found for this track.</p>
        )}

        {!loading && data?.instrumental && syncedLines.length === 0 && !data.plain && (
          <p className="lyrics__status">Instrumental track.</p>
        )}

        {data?.synced && syncedLines.length > 0 && (
          <div className="lyrics__lines" role="list">
            {syncedLines.map((line, index) => {
              const isActive = index === activeIndex
              const isPast = index < activeIndex
              return (
                <p
                  key={`${line.time}-${index}`}
                  role="listitem"
                  ref={(node) => {
                    lineRefs.current[index] = node
                  }}
                  className="lyric-line"
                  data-active={isActive}
                  data-past={isPast}
                >
                  {line.words && line.words.length > 0
                    ? line.words.map((word, wordIndex) => (
                        <span
                          key={`${word.time}-${wordIndex}`}
                          className="lyric-word"
                          data-current={isActive && wordIndex === activeWord}
                        >
                          {word.text}{' '}
                        </span>
                      ))
                    : line.text}
                </p>
              )
            })}
          </div>
        )}

        {!loading && data && !data.synced && data.plain && (
          <div className="lyrics__plain">{data.plain}</div>
        )}
      </div>
    </GlassPanel>
  )
}
