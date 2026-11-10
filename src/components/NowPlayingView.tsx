/**
 * Full-screen Now Playing: artwork with parallax tilt, glass transport, volume,
 * scrubber and the synced lyrics panel. Slides up with a spring and closes on
 * Escape, respecting prefers-reduced-motion.
 */

import { useEffect } from 'react'
import type { PointerEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion, useSpring } from 'framer-motion'
import type { Palette } from '../lib/palette'
import { usePlayer } from '../player/PlayerProvider'
import { artistNames, formatTime } from '../lib/format'
import { GlassPanel } from './GlassPanel'
import { LyricsPanel } from './LyricsPanel'
import { Slider } from './Slider'
import {
  ChevronDownIcon,
  MuteIcon,
  NextIcon,
  NoteIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  VolumeIcon,
} from './Icons'

interface NowPlayingViewProps {
  open: boolean
  onClose: () => void
  palette: Palette
}

export function NowPlayingView({ open, onClose, palette }: NowPlayingViewProps) {
  const {
    currentTrack,
    isPlaying,
    isLoading,
    position,
    duration,
    volume,
    togglePlay,
    next,
    previous,
    seek,
    setVolume,
  } = usePlayer()

  const reduceMotion = useReducedMotion()
  const rotateX = useSpring(0, { stiffness: 110, damping: 18 })
  const rotateY = useSpring(0, { stiffness: 110, damping: 18 })

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Leave the artwork flat again when the view closes.
  useEffect(() => {
    if (open) return
    rotateX.set(0)
    rotateY.set(0)
  }, [open, rotateX, rotateY])

  const handleTilt = (event: PointerEvent<HTMLDivElement>) => {
    if (reduceMotion) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    rotateY.set(x * 12)
    rotateX.set(-y * 10)
  }

  const resetTilt = () => {
    rotateX.set(0)
    rotateY.set(0)
  }

  const backdrop = currentTrack
    ? [
        `radial-gradient(85% 70% at 8% -5%, ${palette.colors[0]}80 0%, transparent 62%)`,
        `radial-gradient(75% 65% at 96% 2%, ${palette.colors[1]}59 0%, transparent 60%)`,
        `radial-gradient(80% 70% at 55% 108%, ${palette.colors[2]}66 0%, transparent 68%)`,
        'var(--bg)',
      ].join(', ')
    : 'var(--bg)'

  return (
    <AnimatePresence>
      {open && currentTrack && (
        <motion.section
          className="np"
          role="dialog"
          aria-modal="true"
          aria-label="Now playing"
          style={{ background: backdrop }}
          initial={{ y: '100%', opacity: 0.7 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0.7 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 190, damping: 26, mass: 0.9 }
          }
        >
          <div className="np__noise" aria-hidden="true" />

          <header className="np__header">
            <button type="button" className="icon-button np__close" onClick={onClose} aria-label="Close now playing">
              <ChevronDownIcon width={22} height={22} />
            </button>
            <span className="np__header-label">Now Playing</span>
            <span className="np__header-spacer" aria-hidden="true" />
          </header>

          <div className="np__body">
            <section className="np__stage">
              <div
                className="np__art-area"
                onPointerMove={handleTilt}
                onPointerLeave={resetTilt}
              >
                <motion.div
                  className="np__art"
                  style={{ rotateX, rotateY, transformPerspective: 1100 }}
                >
                  {currentTrack.thumbnail ? (
                    <img src={currentTrack.thumbnail} alt="" draggable={false} />
                  ) : (
                    <NoteIcon width={56} height={56} />
                  )}
                </motion.div>
              </div>

              <div className="np__meta">
                <h1 className="np__title">{currentTrack.title}</h1>
                <p className="np__artist">{artistNames(currentTrack.artists)}</p>
                {currentTrack.album?.name && <p className="np__album">{currentTrack.album.name}</p>}
              </div>

              <div className="np__progress">
                <Slider
                  value={position}
                  max={duration}
                  onChange={seek}
                  ariaLabel="Seek"
                  step={0.1}
                />
                <div className="np__times">
                  <span>{formatTime(position)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <GlassPanel className="np__transport" tone="subtle">
                <button type="button" className="np__btn" onClick={previous} aria-label="Previous track">
                  <PreviousIcon width={26} height={26} />
                </button>
                <button
                  type="button"
                  className="np__play"
                  onClick={togglePlay}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isLoading ? (
                    <span className="np__spinner" aria-hidden="true" />
                  ) : isPlaying ? (
                    <PauseIcon width={26} height={26} />
                  ) : (
                    <PlayIcon width={26} height={26} />
                  )}
                </button>
                <button type="button" className="np__btn" onClick={next} aria-label="Next track">
                  <NextIcon width={26} height={26} />
                </button>
              </GlassPanel>

              <div className="np__volume">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
                  aria-label={volume > 0 ? 'Mute' : 'Unmute'}
                >
                  {volume > 0 ? <VolumeIcon width={19} height={19} /> : <MuteIcon width={19} height={19} />}
                </button>
                <Slider
                  value={volume}
                  max={1}
                  step={0.01}
                  onChange={setVolume}
                  ariaLabel="Volume"
                  className="slider--volume"
                />
              </div>
            </section>

            <LyricsPanel key={currentTrack.id} track={currentTrack} open={open} />
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
