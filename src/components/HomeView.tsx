import type { Track } from '../api/types'
import { artistNames } from '../lib/format'
import { GlassPanel } from './GlassPanel'
import { NoteIcon, PlayIcon, SearchIcon } from './Icons'
import { SongList } from './SongList'

interface HomeViewProps {
  recents: Track[]
  onPlay: (tracks: Track[], index: number) => void
  onStartSearch: () => void
}

/**
 * Listen Now. Listening history is session-only for now; favourites and a
 * persisted history are still to come (playlists already live in SQLite).
 */
export function HomeView({ recents, onPlay, onStartSearch }: HomeViewProps) {
  const lead = recents[0] ?? null

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Listen Now</p>
        <h1 className="page__title">
          {recents.length > 0 ? 'Pick up where you left off' : 'Listen Now'}
        </h1>
        <p className="page__subtitle">Streaming from YouTube Music · nothing saved to disk</p>
      </header>

      {lead ? (
        <GlassPanel className="hero" tone="subtle">
          <div className="hero__art">
            {lead.thumbnail ? <img src={lead.thumbnail} alt="" /> : <NoteIcon width={28} height={28} />}
          </div>
          <div className="hero__text">
            <span className="hero__label">Last played</span>
            <h2 className="hero__title">{lead.title}</h2>
            <p className="hero__subtitle">
              {artistNames(lead.artists)}
              {lead.album?.name ? ` — ${lead.album.name}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="button button--primary"
            onClick={() => onPlay(recents, 0)}
            disabled={recents.length === 0}
          >
            <PlayIcon width={15} height={15} />
            Play
          </button>
        </GlassPanel>
      ) : (
        <GlassPanel className="hero hero--empty" tone="subtle">
          <div className="hero__art hero__art--empty">
            <NoteIcon width={26} height={26} />
          </div>
          <div className="hero__text">
            <span className="hero__label">Get started</span>
            <h2 className="hero__title">Find something to play</h2>
            <p className="hero__subtitle">
              Search for a song, album or artist. Tracks you play show up here for this session.
            </p>
          </div>
          <button type="button" className="button" onClick={onStartSearch}>
            <SearchIcon width={15} height={15} />
            Search
          </button>
        </GlassPanel>
      )}

      {recents.length > 1 && (
        <section className="section">
          <h2 className="section__title">Recently played</h2>
          <SongList tracks={recents} onPlay={onPlay} />
        </section>
      )}
    </div>
  )
}
