import { useState } from 'react'
import type { FormEvent } from 'react'
import { useApi } from './api/useApi'
import type { SearchResults, Track } from './api/types'
import { useAlbumPalette } from './lib/palette'
import { usePlayer } from './player/PlayerProvider'
import { AlbumView } from './components/AlbumView'
import { ArtistView } from './components/ArtistView'
import { BackendBanner } from './components/BackendBanner'
import { BrowseView } from './components/BrowseView'
import { GlassFilters } from './components/GlassFilters'
import { GlassPanel } from './components/GlassPanel'
import { HomeView } from './components/HomeView'
import { LibraryPlaylistView } from './components/LibraryPlaylistView'
import { MeshBackground } from './components/MeshBackground'
import { NowPlayingBar } from './components/NowPlayingBar'
import { NowPlayingView } from './components/NowPlayingView'
import { PlaylistView } from './components/PlaylistView'
import { PlaylistsView } from './components/PlaylistsView'
import { SearchView } from './components/SearchView'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import type { NavSection } from './components/Sidebar'
import { WindowControls } from './components/WindowControls'
import { BackIcon, CloseIcon, SearchIcon } from './components/Icons'

type Detail = { kind: 'album' | 'artist' | 'playlist' | 'libraryPlaylist'; id: string }

const LIBRARY_HINT =
  'Favourites, saved albums and listening history are not implemented yet. Playlists are live under Playlists.'

export default function App() {
  const { playQueue, currentTrack, recentTracks } = usePlayer()
  const palette = useAlbumPalette(currentTrack)

  const [nav, setNav] = useState<NavSection>('home')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [input, setInput] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)

  const search = useApi<SearchResults>(submitted ? '/api/search' : null, {
    q: submitted,
    filter: 'all',
    limit: 20,
  })

  const navigate = (section: NavSection) => {
    setNav(section)
    setDetail(null)
  }

  const runSearch = (term: string) => {
    const query = term.trim()
    if (!query) return
    setInput(query)
    setSubmitted(query)
    setNav('search')
    setDetail(null)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    runSearch(input)
  }

  const handlePlay = (tracks: Track[], index: number) => playQueue(tracks, index)
  const openAlbum = (id: string) => setDetail({ kind: 'album', id })
  const openArtist = (id: string) => setDetail({ kind: 'artist', id })
  const openPlaylist = (id: string) => setDetail({ kind: 'playlist', id })
  const openLibraryPlaylist = (id: string) => setDetail({ kind: 'libraryPlaylist', id })

  return (
    <div className="app">
      <MeshBackground palette={palette} intense={nowPlayingOpen} />
      <GlassFilters />

      <div className="shell">
        <Sidebar active={nav} onNavigate={navigate} onOpenSettings={() => setSettingsOpen(true)} />

        <GlassPanel className="main" tone="content">
          <header className="main__header">
            {detail ? (
              <button
                type="button"
                className="icon-button main__back"
                onClick={() => setDetail(null)}
                aria-label="Back"
              >
                <BackIcon width={20} height={20} />
              </button>
            ) : (
              <span className="main__back-spacer" aria-hidden="true" />
            )}

            <form className="searchbar" role="search" onSubmit={handleSubmit}>
              <SearchIcon className="searchbar__icon" width={16} height={16} />
              <input
                className="searchbar__input"
                type="search"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Search songs, albums, artists, playlists"
                aria-label="Search"
                spellCheck={false}
                autoComplete="off"
              />
              {input && (
                <button
                  type="button"
                  className="searchbar__clear"
                  onClick={() => setInput('')}
                  aria-label="Clear search"
                >
                  <CloseIcon width={13} height={13} />
                </button>
              )}
            </form>
          </header>

          <BackendBanner />

          <main className="content">
            {detail?.kind === 'album' && (
              <AlbumView key={detail.id} albumId={detail.id} onPlay={handlePlay} />
            )}
            {detail?.kind === 'artist' && (
              <ArtistView
                key={detail.id}
                artistId={detail.id}
                onPlay={handlePlay}
                onOpenAlbum={openAlbum}
              />
            )}
            {detail?.kind === 'playlist' && (
              <PlaylistView key={detail.id} playlistId={detail.id} onPlay={handlePlay} />
            )}
            {detail?.kind === 'libraryPlaylist' && (
              <LibraryPlaylistView
                key={detail.id}
                playlistId={detail.id}
                onPlay={handlePlay}
                onBack={() => setDetail(null)}
              />
            )}

            {!detail && nav === 'home' && (
              <HomeView
                recents={recentTracks}
                onPlay={handlePlay}
                onStartSearch={() => navigate('search')}
              />
            )}

            {!detail && nav === 'browse' && <BrowseView onSearch={runSearch} />}

            {!detail && nav === 'search' && (
              <SearchView
                query={submitted}
                results={search.data}
                loading={search.loading}
                error={search.error}
                onRetry={search.reload}
                onPlay={handlePlay}
                onOpenAlbum={openAlbum}
                onOpenArtist={openArtist}
                onOpenPlaylist={openPlaylist}
              />
            )}

            {!detail && nav === 'playlists' && (
              <PlaylistsView onOpen={openLibraryPlaylist} />
            )}

            {!detail && nav === 'library' && (
              <div className="page">
                <header className="page__header">
                  <p className="page__eyebrow">Library</p>
                  <h1 className="page__title">Your library</h1>
                </header>
                <GlassPanel className="placeholder" tone="subtle">
                  <h2>Not built yet</h2>
                  <p>{LIBRARY_HINT}</p>
                </GlassPanel>
              </div>
            )}
          </main>
        </GlassPanel>
      </div>

      <NowPlayingBar onOpenNowPlaying={() => setNowPlayingOpen(true)} />

      <NowPlayingView
        open={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        palette={palette}
      />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <WindowControls />
    </div>
  )
}
