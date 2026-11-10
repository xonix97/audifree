/**
 * Renderer-side access to the local library.
 *
 * Every song row can add itself to a playlist, so the dialog lives once here
 * and components only need `useLibrary().openAddToPlaylist(tracks)`.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Track } from '../api/types'
import { AddToPlaylistDialog } from '../components/AddToPlaylistDialog'

interface LibraryValue {
  openAddToPlaylist: (tracks: Track[]) => void
  /** Incremented whenever the picker closes, so open views can refetch. */
  version: number
}

const LibraryContext = createContext<LibraryValue | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Track[] | null>(null)
  const [version, setVersion] = useState(0)

  const openAddToPlaylist = useCallback((tracks: Track[]) => {
    if (tracks.length > 0) setPending(tracks)
  }, [])

  const closeDialog = useCallback(() => {
    setPending(null)
    setVersion((value) => value + 1)
  }, [])

  const value = useMemo<LibraryValue>(
    () => ({ openAddToPlaylist, version }),
    [openAddToPlaylist, version],
  )

  return (
    <LibraryContext.Provider value={value}>
      {children}
      <AddToPlaylistDialog tracks={pending} onClose={closeDialog} />
    </LibraryContext.Provider>
  )
}

export function useLibrary(): LibraryValue {
  const context = useContext(LibraryContext)
  if (!context) throw new Error('useLibrary must be used inside <LibraryProvider>')
  return context
}
