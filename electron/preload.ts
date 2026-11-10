/**
 * The entire privileged surface exposed to the renderer.
 *
 * Everything the UI needs from the main process goes through this narrow,
 * explicitly typed bridge; the renderer never sees Node or ipcRenderer.
 */

import { contextBridge, ipcRenderer } from 'electron'

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

const bridge = {
  platform: process.platform,
  getBackend: (): Promise<BackendInfo> => ipcRenderer.invoke('backend:info'),
  restartBackend: (): Promise<BackendInfo> => ipcRenderer.invoke('backend:restart'),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  onBackendStatus: (callback: (status: SidecarStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: SidecarStatus) => callback(status)
    ipcRenderer.on('backend:status', listener)
    return () => {
      ipcRenderer.removeListener('backend:status', listener)
    }
  },

  // Renderer-drawn window controls (frameless window).
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (_event: unknown, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => {
      ipcRenderer.removeListener('window:maximized', listener)
    }
  },
}

contextBridge.exposeInMainWorld('audifree', bridge)

export type AudifreeBridge = typeof bridge
