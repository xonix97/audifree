import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { LibraryProvider } from './library/LibraryProvider'
import { PlayerProvider } from './player/PlayerProvider'
import { SettingsProvider } from './settings/SettingsProvider'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <SettingsProvider>
      <PlayerProvider>
        <LibraryProvider>
          <App />
        </LibraryProvider>
      </PlayerProvider>
    </SettingsProvider>
  </StrictMode>,
)
