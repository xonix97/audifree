import { useApi } from '../api/useApi'
import type { AlbumDetail, Track } from '../api/types'
import { artistNames } from '../lib/format'
import { useLibrary } from '../library/LibraryProvider'
import { ErrorState, Spinner } from './Feedback'
import { PlayIcon, PlusIcon } from './Icons'
import { SongList } from './SongList'

interface AlbumViewProps {
  albumId: string
  onPlay: (tracks: Track[], index: number) => void
}

export function AlbumView({ albumId, onPlay }: AlbumViewProps) {
  const { data, loading, error, reload } = useApi<AlbumDetail>(`/api/albums/${albumId}`)
  const { openAddToPlaylist } = useLibrary()

  if (loading && !data) return <Spinner label="Loading album…" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  const meta = [artistNames(data.artists), data.year, `${data.tracks.length} songs`]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="detail">
      <header className="detail__header">
        <div className="detail__art">
          {data.thumbnail ? <img src={data.thumbnail} alt="" /> : <span aria-hidden="true">♪</span>}
        </div>
        <div className="detail__meta">
          <p className="detail__kind">{data.kind || 'Album'}</p>
          <h1>{data.title}</h1>
          <p className="muted">{meta}</p>
          <div className="detail__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={data.tracks.length === 0}
              onClick={() => onPlay(data.tracks, 0)}
            >
              <PlayIcon width={16} height={16} /> Play
            </button>
            <button
              type="button"
              className="button"
              disabled={data.tracks.length === 0}
              onClick={() => openAddToPlaylist(data.tracks)}
            >
              <PlusIcon width={15} height={15} /> Add to playlist
            </button>
          </div>
        </div>
      </header>

      <SongList tracks={data.tracks} onPlay={onPlay} showAlbum={false} emptyLabel="This album has no playable tracks." />
    </article>
  )
}
