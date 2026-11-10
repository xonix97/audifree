import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useSettings } from '../settings/SettingsProvider'
import { GlassPanel } from './GlassPanel'
import { CloseIcon } from './Icons'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { reduceGlass, setReduceGlass } = useSettings()
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          onClick={onClose}
        >
          <motion.div
            onClick={(event) => event.stopPropagation()}
            initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <GlassPanel className="settings" role="dialog" aria-modal="true" aria-label="Settings">
              <header className="settings__header">
                <h2>Settings</h2>
                <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
                  <CloseIcon width={16} height={16} />
                </button>
              </header>

              <div className="settings__row">
                <div className="settings__text">
                  <span className="settings__title">Reduce glass effects</span>
                  <span className="settings__hint">
                    Swaps the live backdrop blur and refraction for solid translucent panels. Use it on
                    weak GPUs or if the window looks noisy.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reduceGlass}
                  aria-label="Reduce glass effects"
                  className="switch"
                  data-on={reduceGlass}
                  onClick={() => setReduceGlass(!reduceGlass)}
                >
                  <span className="switch__knob" />
                </button>
              </div>

              <div className="settings__row settings__row--static">
                <div className="settings__text">
                  <span className="settings__title">Appearance</span>
                  <span className="settings__hint">
                    Follows the system light/dark theme automatically.
                  </span>
                </div>
                <span className="settings__value">System</span>
              </div>

              <p className="settings__note">
                Music is never written to disk. Streams are resolved on demand and cached in memory only.
              </p>
            </GlassPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
