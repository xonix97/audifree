/**
 * Electron main process.
 *
 * Responsibilities:
 *  - Wayland flags (must be set before `app.whenReady`)
 *  - the single application window (frameless + native window-controls overlay)
 *  - starting/stopping the Python sidecar
 *  - a tiny, validated IPC surface for the renderer
 */

import path from 'node:path'
import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { Sidecar } from './sidecar'

// --- Chromium flags -------------------------------------------------------
// Wayland switches are Linux-only; passing them elsewhere is harmless but
// nonsensical, and macOS/Windows use their own windowing paths.
if (process.platform === 'linux') {
  // Native Wayland with client-side decorations; the hint lets Chromium pick
  // Wayland when available and fall back to XWayland otherwise.
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
  // KDE/Wayland input methods for the search box.
  app.commandLine.appendSwitch('enable-wayland-ime')
}
// A music player must be able to start a track without a fresh click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

if (process.env.AUDIFREE_DISABLE_GPU === '1') {
  // Documented fallback for broken NVIDIA/Wayland compositing.
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

app.setName('audifree')

// Windows groups taskbar entries by AppUserModelID; without it the app shows
// up as "electron.exe".
if (process.platform === 'win32') {
  app.setAppUserModelId('com.audifree.app')
}

const devServerUrl = process.env.VITE_DEV_SERVER_URL
const isDev = !app.isPackaged && Boolean(devServerUrl)

const sidecar = new Sidecar()
let quitting = false

const THEME_BACKGROUND = '#0d0d12'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: THEME_BACKGROUND,
    title: 'Audifree',
    // Frameless content. `titleBarStyle` alone is not enough on Linux, so the
    // frame is removed explicitly there and on Windows; the renderer draws the
    // controls (transparent, no native overlay strip). macOS keeps its native
    // traffic lights.
    frame: process.platform === 'darwin',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 14 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // The renderer plays remote CDN audio; no Node access is needed.
      webSecurity: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  const sendMaximized = (value: boolean) => {
    window.webContents.send('window:maximized', value)
  }
  window.on('maximize', () => sendMaximized(true))
  window.on('unmaximize', () => sendMaximized(false))

  // Never navigate the app window; open links in the user's browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev && devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://')
    if (!allowed) {
      event.preventDefault()
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    }
  })

  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  return window
}

function registerIpc(): void {
  ipcMain.handle('backend:info', () => sidecar.ready())
  ipcMain.handle('backend:restart', () => sidecar.restart())

  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    isPackaged: app.isPackaged,
  }))

  ipcMain.handle('shell:openExternal', async (_event, url: unknown) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url)
    }
  })

  // Custom window controls (the app is frameless; no native overlay tint).
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:toggleMaximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  sidecar.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('backend:status', status)
    }
  })
}

// Chromium locks its user-data directory; without this, launching a second
// instance while one is running makes both behave unpredictably.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(() => {
    // Deny every permission request (camera, mic, geolocation, notifications
    // via the web API); the app uses native desktop features instead.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false)
    })

    registerIpc()
    createWindow()

    // Start the backend in parallel with the window; the renderer waits for
    // `backend:info`, so a slow import never blocks first paint.
    void sidecar.ready().catch((error) => {
      console.error('[sidecar] failed to start', error)
    })
  })
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void sidecar
    .stop()
    .catch((error) => console.error('[sidecar] stop failed', error))
    .finally(() => app.quit())
})
