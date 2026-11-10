interface BrowseViewProps {
  onSearch: (term: string) => void
}

const GENRE_NAMES = [
  'Pop',
  'Hip-Hop',
  'Rock',
  'Electronic',
  'R&B',
  'Jazz',
  'Classical',
  'Metal',
  'Indie',
  'Latin',
  'K-Pop',
  'Ambient',
]

/** Black/white only: tiles vary in depth, never in hue. */
const TILE_SHADES: [string, string][] = [
  ['#3c3c3c', '#161616'],
  ['#2b2b2b', '#0f0f0f'],
  ['#4a4a4a', '#1b1b1b'],
  ['#242424', '#0b0b0b'],
]

const GENRES: { name: string; colors: [string, string] }[] = GENRE_NAMES.map(
  (name, index) => ({ name, colors: TILE_SHADES[index % TILE_SHADES.length]! }),
)

/** Genre shortcuts that run a normal catalogue search. */
export function BrowseView({ onSearch }: BrowseViewProps) {
  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Browse</p>
        <h1 className="page__title">Explore by genre</h1>
        <p className="page__subtitle">Each tile runs a live search across the YouTube Music catalogue.</p>
      </header>

      <div className="genre-grid">
        {GENRES.map((genre) => (
          <button
            key={genre.name}
            type="button"
            className="genre-card"
            style={{
              background: `linear-gradient(135deg, ${genre.colors[0]} 0%, ${genre.colors[1]} 100%)`,
            }}
            onClick={() => onSearch(genre.name)}
          >
            <span className="genre-card__label">{genre.name}</span>
            <span className="genre-card__orb" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}
