import { useRef } from 'react'
import { usePlayer } from '../player/PlayerProvider'
import { artistNames, formatTime } from '../lib/format'
import { GlassPanel } from './GlassPanel'
import { Slider } from './Slider'
import {
  ChevronUpIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  VolumeIcon,
} from './Icons'

interface NowPlayingBarProps {
  onOpenNowPlaying: () => void
}

export function NowPlayingBar({ onOpenNowPlaying }: NowPlayingBarProps) {
  const {
    currentTrack,
    isPlaying,
    isLoading,
    error,
    position,
    duration,
    volume,
    togglePlay,
    next,
    previous,
    seek,
    setVolume,
    queue,
  } = usePlayer()

  const lastVolume = useRef(volume > 0 ? volume : 0.8)
  if (volume > 0) lastVolume.current = volume

  const canPlay = currentTrack !== null

  return (
    <footer className="player-dock">
      <GlassPanel className="now-playing" tone="bar" role="region" aria-label="Now playing">
        <div className="now-playing__track">
          <button
            type="button"
            className="now-playing__art"
            onClick={onOpenNowPlaying}
            disabled={!canPlay}
            aria-label="Open now playing"
          >
            {currentTrack?.thumbnail ? (
              <img src={currentTrack.thumbnail} alt="" />
            ) : (
              <span aria-hidden="true">♪</span>
            )}
            <span className="now-playing__art-overlay" aria-hidden="true">
              <ChevronUpIcon width={16} height={16} />
            </span>
          </button>
          <div className="now-playing__text">
            <span className="now-playing__title">{currentTrack?.title ?? 'Nothing playing'}</span>
            <span className={`now-playing__artist ${error ? 'now-playing__artist--error' : ''}`}>
              {error ?? (currentTrack ? artistNames(currentTrack.artists) : 'Pick a song to start')}
            </span>
          </div>
        </div>

        <div className="now-playing__center">
          <div className="transport">
            <button
              type="button"
              className="icon-button"
              onClick={previous}
              disabled={!canPlay}
              aria-label="Previous track"
            >
              <PreviousIcon width={20} height={20} />
            </button>
            <button
              type="button"
              className="transport__play"
              onClick={togglePlay}
              disabled={!canPlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isLoading ? (
                <span className="transport__spinner" aria-hidden="true" />
              ) : isPlaying ? (
                <PauseIcon width={19} height={19} />
              ) : (
                <PlayIcon width={19} height={19} />
              )}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={next}
              disabled={queue.length === 0}
              aria-label="Next track"
            >
              <NextIcon width={20} height={20} />
            </button>
          </div>

          <div className="scrubber">
            <span className="scrubber__time">{formatTime(position)}</span>
            <Slider
              value={position}
              max={duration}
              onChange={seek}
              ariaLabel="Seek"
              disabled={!canPlay}
            />
            <span className="scrubber__time">{formatTime(duration)}</span>
          </div>
        </div>

        <div className="now-playing__volume">
          <button
            type="button"
            className="icon-button"
            onClick={() => setVolume(volume > 0 ? 0 : lastVolume.current)}
            aria-label={volume > 0 ? 'Mute' : 'Unmute'}
          >
            {volume > 0 ? <VolumeIcon width={18} height={18} /> : <MuteIcon width={18} height={18} />}
          </button>
          <Slider
            value={volume}
            max={1}
            step={0.01}
            onChange={setVolume}
            ariaLabel="Volume"
            className="slider--volume"
          />
          <button
            type="button"
            className="icon-button now-playing__expand"
            onClick={onOpenNowPlaying}
            disabled={!canPlay}
            aria-label="Open now playing"
          >
            <ChevronUpIcon width={18} height={18} />
          </button>
        </div>
      </GlassPanel>
    </footer>
  )
}
