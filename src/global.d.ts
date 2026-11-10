/** Types for the preload bridge exposed as `window.audifree`. */

export interface BackendInfo {
  baseUrl: string
  token: string
}

export interface SidecarStatus {
  state: 'starting' | 'ready' | 'error' | 'stopped'
  message?: string
  baseUrl?: string
}

export interface AppInfo {
  platform: string
  arch: string
  electron: string
  chrome: string
  node: string
  isPackaged: boolean
}

export interface AudifreeBridge {
  platform: string
  getBackend: () => Promise<BackendInfo>
  restartBackend: () => Promise<BackendInfo>
  getAppInfo: () => Promise<AppInfo>
  openExternal: (url: string) => Promise<void>
  onBackendStatus: (callback: (status: SidecarStatus) => void) => () => void
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  closeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
}

declare global {
  interface Window {
    audifree: AudifreeBridge
  }
}

export {}
