/**
 * Frameless-window controls drawn by the renderer.
 *
 * These replace Electron's native title-bar overlay so there is no solid
 * background strip in the top-right corner: buttons are transparent until
 * hovered, which keeps the glass/mesh visible edge to edge.
 * macOS keeps its native traffic lights, so nothing is rendered there.
 */

import { useEffect, useState } from 'react'
import { CloseIcon, MaximizeIcon, MinusIcon, RestoreIcon } from './Icons'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const isMac = window.audifree.platform === 'darwin'

  useEffect(() => {
    if (isMac) return
    let cancelled = false
    void window.audifree.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value)
    })
    const unsubscribe = window.audifree.onMaximizedChange(setMaximized)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [isMac])

  if (isMac) return null

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-controls__button"
        onClick={() => void window.audifree.minimize()}
        aria-label="Minimize window"
      >
        <MinusIcon width={14} height={14} />
      </button>
      <button
        type="button"
        className="window-controls__button"
        onClick={() => {
          void window.audifree.toggleMaximize().then(setMaximized)
        }}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
      >
        {maximized ? <RestoreIcon width={13} height={13} /> : <MaximizeIcon width={13} height={13} />}
      </button>
      <button
        type="button"
        className="window-controls__button window-controls__button--close"
        onClick={() => void window.audifree.closeWindow()}
        aria-label="Close window"
      >
        <CloseIcon width={14} height={14} />
      </button>
    </div>
  )
}
