import { useApi } from '../api/useApi'
import type { ArtistDetail, Track } from '../api/types'
import { CoverCard } from './CoverCard'
import { ErrorState, Spinner } from './Feedback'
import { SongList } from './SongList'

interface ArtistViewProps {
  artistId: string
  onPlay: (tracks: Track[], index: number) => void
  onOpenAlbum: (id: string) => void
}

export function ArtistView({ artistId, onPlay, onOpenAlbum }: ArtistViewProps) {
  const { data, loading, error, reload } = useApi<ArtistDetail>(`/api/artists/${artistId}`)

  if (loading && !data) return <Spinner label="Loading artist…" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  return (
    <article className="detail">
      <header className="detail__header detail__header--artist">
        <div className="detail__art detail__art--round">
          {data.thumbnail ? <img src={data.thumbnail} alt="" /> : <span aria-hidden="true">♪</span>}
        </div>
        <div className="detail__meta">
          <p className="detail__kind">Artist</p>
          <h1>{data.name}</h1>
          {data.subscribers && <p className="muted">{data.subscribers} subscribers</p>}
        </div>
      </header>

      {data.top_songs.length > 0 && (
        <section className="section">
          <h2 className="section__title">Top songs</h2>
          <SongList tracks={data.top_songs} onPlay={onPlay} />
        </section>
      )}

      {data.albums.length > 0 && (
        <section className="section">
          <h2 className="section__title">Albums</h2>
          <div className="card-grid">
            {data.albums.map((album) => (
              <CoverCard
                key={album.id}
                image={album.thumbnail}
                title={album.title}
                subtitle={album.year ?? undefined}
                onClick={() => onOpenAlbum(album.id)}
              />
            ))}
          </div>
        </section>
      )}

      {data.singles.length > 0 && (
        <section className="section">
          <h2 className="section__title">Singles & EPs</h2>
          <div className="card-grid">
            {data.singles.map((album) => (
              <CoverCard
                key={album.id}
                image={album.thumbnail}
                title={album.title}
                subtitle={album.year ?? undefined}
                onClick={() => onOpenAlbum(album.id)}
              />
            ))}
          </div>
        </section>
      )}

      {data.top_songs.length === 0 && data.albums.length === 0 && data.singles.length === 0 && (
        <p className="muted">No catalog data available for this artist.</p>
      )}
    </article>
  )
}
