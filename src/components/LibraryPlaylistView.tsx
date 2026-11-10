/**
 * A playlist stored in the local SQLite library (hand-built or imported).
 *
 * Same layout as a catalogue playlist, plus rename/delete and per-row removal.
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, apiDelete, apiPatch } from '../api/client'
import type { LibraryPlaylistDetail, Track } from '../api/types'
import { useApi } from '../api/useApi'
import { useLibrary } from '../library/LibraryProvider'
import { ErrorState, Spinner } from './Feedback'
import { GlassPanel } from './GlassPanel'
import { PlayIcon } from './Icons'
import { SongList } from './SongList'

interface LibraryPlaylistViewProps {
  playlistId: string
  onPlay: (tracks: Track[], index: number) => void
  /** Called after the playlist is deleted, to return to the list. */
  onBack: () => void
}

function describe(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message
  return cause instanceof Error ? cause.message : String(cause)
}

export function LibraryPlaylistView({ playlistId, onPlay, onBack }: LibraryPlaylistViewProps) {
  const { version } = useLibrary()
  const { data, loading, error, reload } = useApi<LibraryPlaylistDetail>(
    `/api/library/playlists/${playlistId}`,
    undefined,
    version,
  )

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  if (loading && !data) return <Spinner label="Loading playlist…" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  const imported = data.source !== 'local'
  const sourceName =
    data.source === 'spotify' ? 'Spotify' : data.source === 'youtube_music' ? 'YouTube Music' : null
  const meta = [data.owner, `${data.tracks.length} songs`].filter(Boolean).join(' · ')

  const startRename = () => {
    setDraft(data.name)
    setFailure(null)
    setRenaming(true)
  }

  const saveName = async (event: FormEvent) => {
    event.preventDefault()
    const clean = draft.trim()
    if (!clean) return
    setBusy(true)
    setFailure(null)
    try {
      await apiPatch<LibraryPlaylistDetail>(`/api/library/playlists/${data.id}`, {
        name: clean,
      })
      setRenaming(false)
      reload()
    } catch (cause) {
      setFailure(describe(cause))
    } finally {
      setBusy(false)
    }
  }

  const removeTrack = async (_track: unknown, index: number) => {
    const entry = data.tracks[index]
    if (!entry || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await apiDelete<LibraryPlaylistDetail>(
        `/api/library/playlists/${data.id}/tracks/${entry.entry_id}`,
      )
      reload()
    } catch (cause) {
      setFailure(describe(cause))
    } finally {
      setBusy(false)
    }
  }

  const deletePlaylist = async () => {
    setBusy(true)
    setFailure(null)
    try {
      await apiDelete<{ ok: boolean }>(`/api/library/playlists/${data.id}`)
      onBack()
    } catch (cause) {
      setFailure(describe(cause))
      setBusy(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <article className="detail">
      <header className="detail__header">
        <div className="detail__art">
          {data.thumbnail ? <img src={data.thumbnail} alt="" /> : <span aria-hidden="true">♪</span>}
        </div>
        <div className="detail__meta">
          <p className="detail__kind">
            {imported ? 'Imported playlist' : 'Playlist'}
            {sourceName && <span className="source-tag">{sourceName}</span>}
          </p>
          <h1>{data.name}</h1>
          <p className="muted">{meta}</p>
          {data.description && <p className="detail__description">{data.description}</p>}

          {renaming ? (
            <form className="inline-form detail__actions" onSubmit={saveName}>
              <input
                className="text-input"
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="Playlist name"
                maxLength={120}
                autoFocus
                disabled={busy}
              />
              <button type="submit" className="button button--primary" disabled={busy || !draft.trim()}>
                Save
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setRenaming(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="detail__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={data.tracks.length === 0}
                onClick={() => onPlay(data.tracks, 0)}
              >
                <PlayIcon width={16} height={16} /> Play
              </button>
              <button type="button" className="button" onClick={startRename} disabled={busy}>
                Rename
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </header>

      {failure && (
        <p className="form-error" role="alert">
          {failure}
        </p>
      )}

      <SongList
        tracks={data.tracks}
        onPlay={onPlay}
        showAlbum
        onRemove={(track, index) => void removeTrack(track, index)}
        emptyLabel={
          imported
            ? 'The import stored no playable tracks. Try importing the link again.'
            : 'This playlist is empty. Use the + button on any song to add it.'
        }
      />

      <p className="page__footnote">
        {imported
          ? `Imported from ${sourceName}. Paste the same link on the Playlists page to refresh it.`
          : `Stored on this device in SQLite · last updated ${new Date(data.updated_at).toLocaleString()}`}
      </p>

      {confirmingDelete && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            if (!busy) setConfirmingDelete(false)
          }}
        >
          <div onClick={(event) => event.stopPropagation()}>
            <GlassPanel
              className="settings confirm"
              role="alertdialog"
              aria-modal="true"
              aria-label={`Delete ${data.name}`}
            >
              <h2 className="confirm__title">Delete “{data.name}”?</h2>
              <p className="confirm__body">
                This removes the playlist and its {data.tracks.length} saved song
                {data.tracks.length === 1 ? '' : 's'} from this device.
                {imported ? ' The original playlist itself is untouched.' : ''}
              </p>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void deletePlaylist()}
                  disabled={busy}
                >
                  {busy ? 'Deleting…' : 'Delete playlist'}
                </button>
              </div>
            </GlassPanel>
          </div>
        </div>
      )}
    </article>
  )
}
