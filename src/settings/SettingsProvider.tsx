/**
 * UI-only settings. `reduceGlass` swaps the liquid-glass material for solid
 * translucent panels on weak GPUs and is persisted in localStorage (not the
 * library database — it is a per-machine display preference).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

interface SettingsValue {
  reduceGlass: boolean
  setReduceGlass: (value: boolean) => void
}

const STORAGE_KEY = 'audifree.settings.reduceGlass'

const SettingsContext = createContext<SettingsValue | null>(null)

function readInitial(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [reduceGlass, setReduceGlassState] = useState(readInitial)

  useEffect(() => {
    document.documentElement.dataset.glass = reduceGlass ? 'reduced' : 'full'
    try {
      window.localStorage.setItem(STORAGE_KEY, reduceGlass ? '1' : '0')
    } catch {
      // Storage can be unavailable in private/sandboxed contexts; the setting
      // still applies for this session.
    }
  }, [reduceGlass])

  const setReduceGlass = useCallback((value: boolean) => setReduceGlassState(value), [])

  const value = useMemo<SettingsValue>(
    () => ({ reduceGlass, setReduceGlass }),
    [reduceGlass, setReduceGlass],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used inside <SettingsProvider>')
  return context
}
