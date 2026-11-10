import { usePlayer } from '../player/PlayerProvider'
import { useLibrary } from '../library/LibraryProvider'
import type { Track } from '../api/types'
import { artistNames, formatTime } from '../lib/format'
import { MinusIcon, PlusIcon } from './Icons'

interface SongListProps {
  tracks: Track[]
  onPlay: (tracks: Track[], index: number) => void
  /** Show the album column (album pages already imply the album). */
  showAlbum?: boolean
  emptyLabel?: string
  /** When given, rows get a remove button (local playlists only). */
  onRemove?: (track: Track, index: number) => void
}

export function SongList({
  tracks,
  onPlay,
  showAlbum = true,
  emptyLabel,
  onRemove,
}: SongListProps) {
  const { currentTrack, isPlaying } = usePlayer()
  const { openAddToPlaylist } = useLibrary()

  if (tracks.length === 0) {
    return <p className="muted">{emptyLabel ?? 'Nothing here yet.'}</p>
  }

  return (
    <div className={`song-list ${showAlbum ? '' : 'song-list--compact'}`} role="list">
      <div className="song-list__head" aria-hidden="true">
        <span className="song-list__num">#</span>
        <span>Title</span>
        {showAlbum && <span className="song-list__album">Album</span>}
        <span className="song-list__time">Time</span>
      </div>
      {tracks.map((track, trackIndex) => {
        const active = currentTrack?.id === track.id
        return (
          <div className="song-row-wrap" role="listitem" key={`${track.id}-${trackIndex}`}>
            <button
              type="button"
              className="song-row"
              data-active={active}
              onClick={() => onPlay(tracks, trackIndex)}
              aria-label={`Play ${track.title}`}
            >
              <span className="song-list__num">
                {active ? (
                  <span className={`eq ${isPlaying ? 'eq--playing' : ''}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  track.track_number ?? trackIndex + 1
                )}
              </span>
              <span className="song-row__main">
                {track.thumbnail && (
                  <img className="song-row__art" src={track.thumbnail} alt="" loading="lazy" />
                )}
                <span className="song-row__text">
                  <span className="song-row__title">
                    {track.title}
                    {track.explicit && <span className="badge">E</span>}
                  </span>
                  <span className="song-row__artist">{artistNames(track.artists)}</span>
                </span>
              </span>
              {showAlbum && <span className="song-list__album">{track.album?.name ?? '—'}</span>}
              <span className="song-list__time">{formatTime(track.duration)}</span>
            </button>

            <span className="song-row__tools">
              {onRemove && (
                <button
                  type="button"
                  className="row-tool"
                  title="Remove from this playlist"
                  aria-label={`Remove ${track.title} from this playlist`}
                  onClick={() => onRemove(track, trackIndex)}
                >
                  <MinusIcon width={14} height={14} />
                </button>
              )}
              <button
                type="button"
                className="row-tool"
                title="Add to playlist"
                aria-label={`Add ${track.title} to a playlist`}
                onClick={() => openAddToPlaylist([track])}
              >
                <PlusIcon width={14} height={14} />
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}
