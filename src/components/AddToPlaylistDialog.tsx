/**
 * "Add to playlist" sheet: pick an existing local playlist or name a new one.
 *
 * Opened from every song row's + button (and album/playlist headers), so the
 * renderer never needs its own copy of the library list.
 */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ApiError, apiPost } from '../api/client'
import type { LibraryPlaylistDetail, LibraryPlaylistSummary, Track } from '../api/types'
import { useApi } from '../api/useApi'
import { Spinner } from './Feedback'
import { GlassPanel } from './GlassPanel'
import { CloseIcon, NoteIcon, PlusIcon } from './Icons'

interface AddToPlaylistDialogProps {
  /** Tracks to add; `null` closes the dialog. */
  tracks: Track[] | null
  onClose: () => void
}

function describe(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message
  return cause instanceof Error ? cause.message : String(cause)
}

export function AddToPlaylistDialog({ tracks, onClose }: AddToPlaylistDialogProps) {
  const open = tracks !== null
  const reduceMotion = useReducedMotion()
  const { data, loading, error, reload } = useApi<LibraryPlaylistSummary[]>(
    open ? '/api/library/playlists' : null,
  )

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setBusy(false)
    setStatus(null)
    setFailure(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  // Let the confirmation linger briefly, then get out of the way.
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(onClose, 1400)
    return () => clearTimeout(timer)
  }, [status, onClose])

  const count = tracks?.length ?? 0

  const addTo = async (playlist: LibraryPlaylistSummary) => {
    if (!tracks) return
    setBusy(true)
    setFailure(null)
    try {
      await apiPost<LibraryPlaylistDetail>(`/api/library/playlists/${playlist.id}/tracks`, {
        tracks,
      })
      setStatus(`Added ${count} song${count === 1 ? '' : 's'} to “${playlist.name}”.`)
    } catch (cause) {
      setFailure(describe(cause))
      setBusy(false)
    }
  }

  const createAndAdd = async (event: FormEvent) => {
    event.preventDefault()
    const clean = name.trim()
    if (!clean || !tracks) return
    setBusy(true)
    setFailure(null)
    try {
      const playlist = await apiPost<LibraryPlaylistDetail>('/api/library/playlists', {
        name: clean,
      })
      reload()
      await apiPost<LibraryPlaylistDetail>(`/api/library/playlists/${playlist.id}/tracks`, {
        tracks,
      })
      setStatus(`Created “${playlist.name}” with ${count} song${count === 1 ? '' : 's'}.`)
    } catch (cause) {
      setFailure(describe(cause))
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="dialog-backdrop add-dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
          onClick={() => {
            if (!busy) onClose()
          }}
        >
          <motion.div
            onClick={(event) => event.stopPropagation()}
            initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <GlassPanel className="add-dialog" role="dialog" aria-modal="true" aria-label="Add to playlist">
              <header className="settings__header">
                <div>
                  <h2>Add to playlist</h2>
                  <p className="add-dialog__hint">
                    {count} song{count === 1 ? '' : 's'} selected
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={onClose}
                  disabled={busy}
                  aria-label="Close"
                >
                  <CloseIcon width={16} height={16} />
                </button>
              </header>

              {status ? (
                <p className="add-dialog__status" role="status">
                  {status}
                </p>
              ) : (
                <>
                  <div className="add-dialog__list">
                    {loading && !data && <Spinner label="Loading playlists…" />}

                    {error && (
                      <div className="add-dialog__failure">
                        <p>{error.message}</p>
                        <button type="button" className="button button--ghost" onClick={reload}>
                          Try again
                        </button>
                      </div>
                    )}

                    {data?.map((playlist) => (
                      <button
                        key={playlist.id}
                        type="button"
                        className="playlist-option"
                        disabled={busy}
                        onClick={() => void addTo(playlist)}
                      >
                        <span className="playlist-option__art">
                          {playlist.thumbnail ? (
                            <img src={playlist.thumbnail} alt="" loading="lazy" />
                          ) : (
                            <NoteIcon width={16} height={16} />
                          )}
                        </span>
                        <span className="playlist-option__text">
                          <span className="playlist-option__name">{playlist.name}</span>
                          <span className="playlist-option__meta">
                            {playlist.track_count} songs
                            {playlist.source === 'youtube_music' ? ' · Imported' : ''}
                          </span>
                        </span>
                        <PlusIcon className="playlist-option__icon" width={15} height={15} />
                      </button>
                    ))}

                    {data && data.length === 0 && (
                      <p className="muted add-dialog__empty">No playlists yet — name one below.</p>
                    )}
                  </div>

                  <form className="inline-form" onSubmit={createAndAdd}>
                    <input
                      className="text-input"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="New playlist name"
                      aria-label="New playlist name"
                      maxLength={120}
                      disabled={busy}
                    />
                    <button
                      type="submit"
                      className="button button--primary"
                      disabled={busy || !name.trim()}
                    >
                      Create &amp; add
                    </button>
                  </form>
                </>
              )}

              {failure && (
                <p className="form-error" role="alert">
                  {failure}
                </p>
              )}
            </GlassPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
