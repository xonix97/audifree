import type { ApiError } from '../api/client'
import type { SearchResults, Track } from '../api/types'
import { artistNames } from '../lib/format'
import { CoverCard } from './CoverCard'
import { EmptyState, ErrorState, Spinner } from './Feedback'
import { SongList } from './SongList'

interface SearchViewProps {
  query: string
  results: SearchResults | null
  loading: boolean
  error: ApiError | null
  onRetry: () => void
  onPlay: (tracks: Track[], index: number) => void
  onOpenAlbum: (id: string) => void
  onOpenArtist: (id: string) => void
  onOpenPlaylist: (id: string) => void
}

export function SearchView({
  query,
  results,
  loading,
  error,
  onRetry,
  onPlay,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: SearchViewProps) {
  if (!query) {
    return (
      <EmptyState
        title="Search YouTube Music"
        hint="Find songs, albums, artists and playlists. Playback never touches your disk."
      />
    )
  }

  if (loading && !results) return <Spinner label="Searching…" />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!results) return null

  const isEmpty =
    results.songs.length === 0 &&
    results.albums.length === 0 &&
    results.artists.length === 0 &&
    results.playlists.length === 0

  if (isEmpty) {
    return <EmptyState title={`No results for “${results.query}”`} hint="Check the spelling or try something broader." />
  }

  return (
    <div className="search-results">
      {results.songs.length > 0 && (
        <section className="section">
          <h2 className="section__title">Songs</h2>
          <SongList tracks={results.songs} onPlay={onPlay} />
        </section>
      )}

      {results.albums.length > 0 && (
        <section className="section">
          <h2 className="section__title">Albums</h2>
          <div className="card-grid">
            {results.albums.map((album) => (
              <CoverCard
                key={album.id}
                image={album.thumbnail}
                title={album.title}
                subtitle={artistNames(album.artists)}
                onClick={() => onOpenAlbum(album.id)}
              />
            ))}
          </div>
        </section>
      )}

      {results.artists.length > 0 && (
        <section className="section">
          <h2 className="section__title">Artists</h2>
          <div className="card-grid">
            {results.artists.map((artist) => (
              <CoverCard
                key={artist.id}
                image={artist.thumbnail}
                title={artist.name}
                subtitle="Artist"
                round
                onClick={() => onOpenArtist(artist.id)}
              />
            ))}
          </div>
        </section>
      )}

      {results.playlists.length > 0 && (
        <section className="section">
          <h2 className="section__title">Playlists</h2>
          <div className="card-grid">
            {results.playlists.map((playlist) => (
              <CoverCard
                key={playlist.id}
                image={playlist.thumbnail}
                title={playlist.title}
                subtitle={playlist.owner ?? 'Playlist'}
                onClick={() => onOpenPlaylist(playlist.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
