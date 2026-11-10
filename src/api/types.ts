/**
 * Mirrors backend/app/models.py. Keep both sides in sync.
 */

export interface ArtistRef {
  id: string | null
  name: string
}

export interface AlbumRef {
  id: string | null
  name: string
}

export interface Track {
  id: string
  provider: string
  title: string
  artists: ArtistRef[]
  album: AlbumRef | null
  duration: number | null
  thumbnail: string | null
  explicit: boolean
  track_number: number | null
}

export interface AlbumSummary {
  id: string
  provider: string
  title: string
  artists: ArtistRef[]
  year: string | null
  thumbnail: string | null
  track_count: number | null
  kind: string
}

export interface AlbumDetail extends AlbumSummary {
  description: string | null
  tracks: Track[]
}

export interface ArtistSummary {
  id: string
  provider: string
  name: string
  thumbnail: string | null
  subscribers: string | null
}

export interface ArtistDetail extends ArtistSummary {
  description: string | null
  top_songs: Track[]
  albums: AlbumSummary[]
  singles: AlbumSummary[]
}

export interface PlaylistSummary {
  id: string
  provider: string
  title: string
  owner: string | null
  thumbnail: string | null
  track_count: number | null
}

export interface PlaylistDetail extends PlaylistSummary {
  description: string | null
  tracks: Track[]
}

/** Local (SQLite-backed) playlists. */
export interface LibraryPlaylistSummary {
  id: string
  name: string
  description: string | null
  /** `local` for playlists built here, `youtube_music` or `spotify` for imports. */
  source: string
  source_id: string | null
  source_url: string | null
  owner: string | null
  thumbnail: string | null
  track_count: number
  created_at: string
  updated_at: string
}

export interface LibraryTrack extends Track {
  entry_id: number
}

export interface LibraryPlaylistDetail extends LibraryPlaylistSummary {
  tracks: LibraryTrack[]
}

/** A Spotify song that could not be matched to a playable track. */
export interface SpotifyImportTrack {
  title: string
  artists: string[]
}

/** Progress of a background Spotify import, polled until `state` is not `running`. */
export interface SpotifyImportJob {
  id: string
  state: 'running' | 'done' | 'error'
  source_url: string
  name: string | null
  playlist_id: string | null
  total: number
  completed: number
  matched: number
  skipped: SpotifyImportTrack[]
  error: string | null
  started_at: string
  finished_at: string | null
}

export interface SearchResults {
  query: string
  songs: Track[]
  albums: AlbumSummary[]
  artists: ArtistSummary[]
  playlists: PlaylistSummary[]
}

export interface StreamInfo {
  track_id: string
  provider: string
  url: string
  mime_type: string | null
  bitrate_kbps: number | null
  codec: string | null
  expires_at: string | null
  resolved_at: string
}

export interface LyricWord {
  time: number
  text: string
}

export interface LyricLine {
  time: number
  text: string
  words: LyricWord[] | null
}

export interface Lyrics {
  provider: string
  synced: boolean
  instrumental: boolean
  lines: LyricLine[]
  plain: string | null
  source_url: string | null
}

export interface DependencyVersions {
  yt_dlp: string | null
  ytmusicapi: string | null
}

export interface ProviderHealth {
  provider: string
  ok: boolean
  checked_at: string
  latency_ms: number | null
  error: string | null
  versions: DependencyVersions
}

export interface HealthResponse {
  ok: boolean
  service: string
  version: string
  python_version: string
  uptime_seconds: number
  provider: ProviderHealth
}

export interface DependencyUpdateResult {
  ok: boolean
  output: string
  versions: DependencyVersions
}
