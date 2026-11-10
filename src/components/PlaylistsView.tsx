/**
 * Playlists page: local playlists plus YouTube Music and Spotify imports, all
 * served from the SQLite library by the sidecar.
 *
 * Spotify playlists arrive as titles and artists, so the sidecar matches every
 * song to a playable track. That takes a search per song, hence the background
 * import job this page polls for progress.
 */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, apiGet, apiPost } from '../api/client'
import type {
  LibraryPlaylistDetail,
  LibraryPlaylistSummary,
  SpotifyImportJob,
} from '../api/types'
import { useApi } from '../api/useApi'
import { useLibrary } from '../library/LibraryProvider'
import { ErrorState, Spinner } from './Feedback'
import { GlassPanel } from './GlassPanel'
import { NoteIcon, PlusIcon } from './Icons'

interface PlaylistsViewProps {
  onOpen: (playlistId: string) => void
}

const SPOTIFY_LINK_RE = /open\.spotify\.com|spotify:playlist:/i
const POLL_INTERVAL_MS = 600

function describe(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message
  return cause instanceof Error ? cause.message : String(cause)
}

export function sourceLabel(source: string): string {
  if (source === 'spotify') return 'Spotify'
  if (source === 'youtube_music') return 'YouTube Music'
  return 'Local'
}

function describeSkipped(job: SpotifyImportJob): string {
  const shown = job.skipped.slice(0, 3).map((track) => `“${track.title}”`)
  const rest = job.skipped.length - shown.length
  const list = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
  return `Imported “${job.name ?? 'playlist'}”: ${job.matched} of ${job.total} songs matched. Not found on YouTube Music: ${list}.`
}

export function PlaylistsView({ onOpen }: PlaylistsViewProps) {
  const { version } = useLibrary()
  const { data, loading, error, reload } = useApi<LibraryPlaylistSummary[]>(
    '/api/library/playlists',
    undefined,
    version,
  )

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState<'create' | 'import' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)

  const createPlaylist = async (event: FormEvent) => {
    event.preventDefault()
    const clean = name.trim()
    if (!clean) return
    setBusy('create')
    setFailure(null)
    setNotice(null)
    try {
      const playlist = await apiPost<LibraryPlaylistDetail>('/api/library/playlists', {
        name: clean,
      })
      setName('')
      onOpen(playlist.id)
    } catch (cause) {
      setFailure(describe(cause))
    } finally {
      setBusy(null)
    }
  }

  const waitForJob = async (first: SpotifyImportJob): Promise<SpotifyImportJob> => {
    let job = first
    setProgress({ completed: job.completed, total: job.total })
    while (mounted.current && job.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      if (!mounted.current) break
      job = await apiGet<SpotifyImportJob>(`/api/library/import/spotify/${job.id}`)
      setProgress({ completed: job.completed, total: job.total })
    }
    if (job.state === 'error') {
      throw new ApiError(job.error ?? 'The Spotify import failed.', 502, 'provider_error', true)
    }
    return job
  }

  const importPlaylist = async (event: FormEvent) => {
    event.preventDefault()
    const clean = link.trim()
    if (!clean) return
    setBusy('import')
    setFailure(null)
    setNotice(null)
    try {
      if (!SPOTIFY_LINK_RE.test(clean)) {
        const playlist = await apiPost<LibraryPlaylistDetail>('/api/library/import', {
          url: clean,
        })
        setLink('')
        reload()
        onOpen(playlist.id)
        return
      }

      const job = await waitForJob(
        await apiPost<SpotifyImportJob>('/api/library/import/spotify', { url: clean }),
      )
      if (!mounted.current) return
      setLink('')
      reload()
      if (job.skipped.length > 0) {
        // Keep the user on the list: the note names the songs that need a
        // manual search, and the imported card is right there.
        setNotice(describeSkipped(job))
      } else if (job.playlist_id) {
        onOpen(job.playlist_id)
      }
    } catch (cause) {
      setFailure(describe(cause))
    } finally {
      if (mounted.current) {
        setBusy(null)
        setProgress(null)
      }
    }
  }

  const importLabel = progress
    ? progress.total > 0
      ? `Matching ${progress.completed} of ${progress.total} songs…`
      : 'Reading Spotify playlist…'
    : 'Importing…'

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">Playlists</p>
        <h1 className="page__title">Your playlists</h1>
        <p className="page__subtitle">
          Saved locally in SQLite. YouTube Music imports keep a snapshot of their tracks; Spotify
          links need no account — their public tracks are matched song-by-song to playable YouTube
          Music tracks.
        </p>
      </header>

      <div className="playlists-toolbar">
        <form className="inline-form" onSubmit={createPlaylist}>
          <input
            className="text-input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New playlist name"
            aria-label="New playlist name"
            maxLength={120}
            disabled={busy !== null}
          />
          <button
            type="submit"
            className="button button--primary"
            disabled={busy !== null || !name.trim()}
          >
            <PlusIcon width={14} height={14} />
            {busy === 'create' ? 'Creating…' : 'New playlist'}
          </button>
        </form>

        <form className="inline-form inline-form--wide" onSubmit={importPlaylist}>
          <input
            className="text-input"
            type="text"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Paste a YouTube Music or Spotify playlist link"
            aria-label="YouTube Music or Spotify playlist link"
            spellCheck={false}
            autoComplete="off"
            disabled={busy !== null}
          />
          <button type="submit" className="button" disabled={busy !== null || !link.trim()}>
            {busy === 'import' ? 'Importing…' : 'Import'}
          </button>
        </form>
      </div>

      {busy === 'import' && (
        <p className="import-progress" role="status">
          <span className="import-progress__ring" aria-hidden="true" />
          {importLabel}
        </p>
      )}

      {notice && !failure && (
        <p className="form-note" role="status">
          {notice}
        </p>
      )}

      {failure && (
        <p className="form-error" role="alert">
          {failure}
        </p>
      )}

      {loading && !data && <Spinner label="Loading your playlists…" />}

      {error && !data && <ErrorState error={error} onRetry={reload} />}

      {data && data.length === 0 && (
        <GlassPanel className="placeholder" tone="subtle">
          <h2>No playlists yet</h2>
          <p>
            Create one above, then add songs with the + button on any song row. Or paste a public
            YouTube Music or Spotify playlist link to import a copy.
          </p>
        </GlassPanel>
      )}

      {data && data.length > 0 && (
        <>
          <div className="playlist-grid">
            {data.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                className="playlist-card"
                onClick={() => onOpen(playlist.id)}
                aria-label={`Open ${playlist.name}`}
              >
                <span className="playlist-card__art">
                  {playlist.thumbnail ? (
                    <img src={playlist.thumbnail} alt="" loading="lazy" />
                  ) : (
                    <NoteIcon width={24} height={24} />
                  )}
                </span>
                <span className="playlist-card__text">
                  <span className="playlist-card__title">{playlist.name}</span>
                  <span className="playlist-card__meta">
                    {playlist.track_count} {playlist.track_count === 1 ? 'song' : 'songs'}
                    {' · '}
                    {sourceLabel(playlist.source)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="page__footnote">
            Imports are snapshots of public playlists; Spotify links import up to 100 songs.
            Re-importing the same link refreshes the existing entry instead of creating a
            duplicate.
          </p>
        </>
      )}
    </div>
  )
}
