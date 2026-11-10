/**
 * Slowly drifting colour mesh extracted from the current album art.
 * Palettes crossfade when the track changes; blobs animate with CSS transforms
 * and stop under `prefers-reduced-motion`.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { Palette } from '../lib/palette'

interface MeshBackgroundProps {
  palette: Palette
  /** More presence behind the full-screen Now Playing view. */
  intense?: boolean
}

export function MeshBackground({ palette, intense = false }: MeshBackgroundProps) {
  const reduceMotion = useReducedMotion()

  return (
    <div
      className={`mesh${intense ? ' mesh--intense' : ''}`}
      aria-hidden="true"
      data-palette={palette.key}
      data-fallback={palette.isFallback ? 'true' : 'false'}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={palette.key}
          className="mesh__layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 1.4, ease: 'easeInOut' }}
        >
          <span
            className="mesh__blob mesh__blob--a"
            style={{ background: `radial-gradient(circle, ${palette.colors[0]} 0%, transparent 66%)` }}
          />
          <span
            className="mesh__blob mesh__blob--b"
            style={{ background: `radial-gradient(circle, ${palette.colors[1]} 0%, transparent 66%)` }}
          />
          <span
            className="mesh__blob mesh__blob--c"
            style={{ background: `radial-gradient(circle, ${palette.colors[2]} 0%, transparent 66%)` }}
          />
        </motion.div>
      </AnimatePresence>
      <div className="mesh__scrim" />
    </div>
  )
}
