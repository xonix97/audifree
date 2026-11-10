/**
 * Playback engine.
 *
 * One HTMLAudioElement lives for the whole session. Stream URLs are resolved
 * lazily through the sidecar right before playback; if the media element
 * errors (typically an expired CDN URL / 403) we ask for one forced refresh
 * per track before surfacing an error.
 *
 * Queue/shuffle/repeat/persistence arrive in phase 3; the queue API here is
 * already the shape the rest of the app uses.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { ApiError, apiGet } from '../api/client'
import type { StreamInfo, Track } from '../api/types'

interface PlayerContextValue {
  queue: Track[]
  currentTrack: Track | null
  /** Tracks played this session, most recent first (phase 2 "Listen Now"). */
  recentTracks: Track[]
  isPlaying: boolean
  isLoading: boolean
  error: string | null
  position: number
  duration: number
  volume: number
  /** Live audio position, for smooth lyric highlighting. */
  getPosition: () => number
  playQueue: (tracks: Track[], startIndex?: number) => void
  togglePlay: () => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  setVolume: (volume: number) => void
  clearError: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

const MAX_STREAM_RETRIES = 1

function describeError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message
  return cause instanceof Error ? cause.message : String(cause)
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [audio] = useState(() => {
    const element = new Audio()
    element.preload = 'auto'
    return element
  })

  const [queue, setQueue] = useState<Track[]>([])
  const [index, setIndex] = useState(-1)
  const [recentTracks, setRecentTracks] = useState<Track[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(0.8)
  const [attempt, setAttempt] = useState(0)

  const currentTrack = index >= 0 ? (queue[index] ?? null) : null

  // Refs let the long-lived audio event listeners read fresh state.
  const queueRef = useRef(queue)
  queueRef.current = queue
  const indexRef = useRef(index)
  indexRef.current = index
  const currentIdRef = useRef<string | null>(currentTrack?.id ?? null)
  currentIdRef.current = currentTrack?.id ?? null

  // How many forced re-resolutions we already used for a given track.
  const retriesRef = useRef(new Map<string, number>())

  // -- resolve + start a track --------------------------------------------
  useEffect(() => {
    const track = queue[index]
    if (!track) return

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setPosition(0)
    setDuration(track.duration ?? 0)

    apiGet<StreamInfo>(`/api/stream/${encodeURIComponent(track.id)}`, {
      refresh: attempt > 0 ? '1' : undefined,
    })
      .then(async (stream) => {
        if (cancelled) return
        audio.src = stream.url
        try {
          await audio.play()
        } catch (playError) {
          if (cancelled) return
          setIsPlaying(false)
          setIsLoading(false)
          if (playError instanceof Error && playError.name === 'AbortError') return
          setIsPlaying(false)
          setError(
            playError instanceof Error && playError.name === 'NotAllowedError'
              ? 'Playback was blocked by the system. Press play to start.'
              : describeError(playError),
          )
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(describeError(cause))
        setIsLoading(false)
        setIsPlaying(false)
      })

    return () => {
      cancelled = true
    }
  }, [audio, queue, index, attempt])

  // -- media element events ------------------------------------------------
  useEffect(() => {
    const handleTime = () => setPosition(audio.currentTime)
    const handleDuration = () =>
      setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0)
    const handlePlaying = () => {
      setIsPlaying(true)
      setIsLoading(false)
      const track = queueRef.current[indexRef.current]
      if (track) {
        setRecentTracks((previous) => {
          if (previous[0]?.id === track.id) return previous
          return [track, ...previous.filter((item) => item.id !== track.id)].slice(0, 15)
        })
      }
    }
    const handlePause = () => setIsPlaying(false)
    const handleWaiting = () => setIsLoading(true)
    const handleCanPlay = () => {
      setIsLoading(false)
      const id = currentIdRef.current
      if (id) retriesRef.current.set(id, 0)
    }
    const handleEnded = () => {
      if (indexRef.current + 1 < queueRef.current.length) {
        setIndex((value) => value + 1)
        setAttempt(0)
      } else {
        setIsPlaying(false)
        setPosition(0)
      }
    }
    const handleError = () => {
      const track = queueRef.current[indexRef.current]
      if (!track) return
      const used = retriesRef.current.get(track.id) ?? 0
      if (used < MAX_STREAM_RETRIES) {
        retriesRef.current.set(track.id, used + 1)
        // Force a fresh CDN URL (expired or IP-bound).
        setAttempt((value) => value + 1)
        return
      }
      setIsLoading(false)
      setIsPlaying(false)
      setError('This track could not be played. It may be unavailable or region-locked.')
    }

    audio.addEventListener('timeupdate', handleTime)
    audio.addEventListener('durationchange', handleDuration)
    audio.addEventListener('playing', handlePlaying)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('waiting', handleWaiting)
    audio.addEventListener('canplay', handleCanPlay)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('timeupdate', handleTime)
      audio.removeEventListener('durationchange', handleDuration)
      audio.removeEventListener('playing', handlePlaying)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('waiting', handleWaiting)
      audio.removeEventListener('canplay', handleCanPlay)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }, [audio])

  useEffect(() => {
    audio.volume = Math.min(1, Math.max(0, volume))
  }, [audio, volume])

  // -- controls -----------------------------------------------------------
  const playQueue = useCallback((tracks: Track[], startIndex = 0) => {
    if (tracks.length === 0) return
    const safeIndex = Math.min(Math.max(startIndex, 0), tracks.length - 1)
    setQueue(tracks)
    setIndex(safeIndex)
    setAttempt(0)
    setError(null)
    setIsPlaying(true)
  }, [])

  const togglePlay = useCallback(() => {
    if (!audio.src) {
      // Nothing loaded yet (or the last attempt failed): ask for a stream.
      setAttempt((value) => value + 1)
      return
    }
    if (audio.paused) {
      void audio.play().catch((cause: unknown) => setError(describeError(cause)))
    } else {
      audio.pause()
    }
  }, [audio])

  const next = useCallback(() => {
    if (indexRef.current + 1 >= queueRef.current.length) {
      audio.pause()
      return
    }
    setIndex((value) => value + 1)
    setAttempt(0)
  }, [audio])

  const previous = useCallback(() => {
    if (audio.currentTime > 3 || indexRef.current <= 0) {
      audio.currentTime = 0
      return
    }
    setIndex((value) => value - 1)
    setAttempt(0)
  }, [audio])

  const seek = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds)) return
      const limit = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : seconds
      audio.currentTime = Math.min(Math.max(seconds, 0), limit)
      setPosition(audio.currentTime)
    },
    [audio],
  )

  const setVolume = useCallback((value: number) => {
    setVolumeState(Math.min(1, Math.max(0, value)))
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const getPosition = useCallback(() => audio.currentTime, [audio])

  const value = useMemo<PlayerContextValue>(
    () => ({
      queue,
      currentTrack,
      recentTracks,
      isPlaying,
      isLoading,
      error,
      position,
      duration,
      volume,
      getPosition,
      playQueue,
      togglePlay,
      next,
      previous,
      seek,
      setVolume,
      clearError,
    }),
    [
      queue,
      currentTrack,
      recentTracks,
      isPlaying,
      isLoading,
      error,
      position,
      duration,
      volume,
      getPosition,
      playQueue,
      togglePlay,
      next,
      previous,
      seek,
      setVolume,
      clearError,
    ],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext)
  if (!context) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return context
}
