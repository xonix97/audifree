/**
 * Owns the Python FastAPI sidecar process.
 *
 * - picks a free loopback port and a random bearer token per launch
 * - spawns `python -u -m app.main` from the app's venv (or AUDIFREE_PYTHON)
 * - waits for /api/health before reporting "ready"
 * - restarts once if the process dies unexpectedly, and reports status so the
 *   renderer can show a banner
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { app } from 'electron'

export type SidecarState = 'starting' | 'ready' | 'error' | 'stopped'

export interface SidecarStatus {
  state: SidecarState
  message?: string
  baseUrl?: string
}

export interface BackendInfo {
  baseUrl: string
  token: string
}

const READY_TIMEOUT_MS = 45_000
const MAX_RESTARTS = 1
const LOG_TAIL_LINES = 40

/** Ask the kernel for an unused port on loopback. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

export class Sidecar {
  readonly token = randomBytes(32).toString('hex')

  private child: ChildProcessByStdio<null, Readable, Readable> | null = null
  private port = 0
  private starting: Promise<BackendInfo> | null = null
  private status: SidecarStatus = { state: 'stopped' }
  private stopping = false
  private restarts = 0
  private readonly listeners = new Set<(status: SidecarStatus) => void>()
  private readonly logTail: string[] = []

  /** Directory that contains the Python package and its venv. */
  get backendDir(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'backend')
      : path.join(app.getAppPath(), 'backend')
  }

  get pythonPath(): string {
    if (process.env.AUDIFREE_PYTHON) return process.env.AUDIFREE_PYTHON

    // Packaged builds ship a Python runtime inside resources/backend: a venv on
    // Linux, an embeddable CPython distribution on Windows.  Development uses
    // the local venv, whose layout differs per platform.
    const windows = process.platform === 'win32'
    const candidates = windows
      ? [
          path.join(this.backendDir, 'python', 'python.exe'),
          path.join(this.backendDir, '.venv', 'Scripts', 'python.exe'),
        ]
      : [
          path.join(this.backendDir, 'python', 'bin', 'python3'),
          path.join(this.backendDir, '.venv', 'bin', 'python'),
        ]

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    return windows ? 'python' : 'python3'
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  onStatus(listener: (status: SidecarStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: SidecarStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }

  /** Resolves once the backend answers /api/health. Safe to call repeatedly. */
  async ready(): Promise<BackendInfo> {
    if (this.status.state === 'ready') {
      return { baseUrl: this.baseUrl, token: this.token }
    }
    if (!this.starting) {
      this.starting = this.start()
    }
    return this.starting
  }

  private async start(): Promise<BackendInfo> {
    this.stopping = false
    this.setStatus({ state: 'starting', message: 'Starting backend…' })

    try {
      this.port = await findFreePort()
      await this.spawn()
      await this.waitForHealthy()
      this.setStatus({ state: 'ready', baseUrl: this.baseUrl })
      return { baseUrl: this.baseUrl, token: this.token }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const detail = this.logTail.slice(-8).join('\n')
      this.setStatus({
        state: 'error',
        message: detail ? `${message}\n${detail}` : message,
        baseUrl: this.port ? this.baseUrl : undefined,
      })
      this.starting = null
      throw error
    }
  }

  private spawn(): Promise<void> {
    const python = this.pythonPath
    const args = ['-u', '-m', 'app.main']
    console.log(`[sidecar] ${python} ${args.join(' ')} (port ${this.port})`)

    const child = spawn(python, args, {
      cwd: this.backendDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        // Windows defaults to the ANSI code page for pipes; track titles are
        // UTF-8, so force it explicitly on every platform.
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        AUDIFREE_PORT: String(this.port),
        AUDIFREE_TOKEN: this.token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // A packaged Windows build should not flash a console window.
      windowsHide: true,
    })
    this.child = child

    const capture = (chunk: Buffer, stream: 'out' | 'err') => {
      const text = chunk.toString()
      if (stream === 'err') process.stderr.write(`[backend] ${text}`)
      else process.stdout.write(`[backend] ${text}`)
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        this.logTail.push(line)
        if (this.logTail.length > LOG_TAIL_LINES) this.logTail.shift()
      }
    }

    child.stdout.on('data', (chunk: Buffer) => capture(chunk, 'out'))
    child.stderr.on('data', (chunk: Buffer) => capture(chunk, 'err'))

    child.on('error', (error) => {
      this.child = null
      this.setStatus({
        state: 'error',
        message: `Could not start the Python backend (${python}): ${error.message}`,
      })
    })

    child.on('exit', (code, signal) => {
      this.child = null
      if (this.stopping) {
        this.setStatus({ state: 'stopped' })
        return
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`
      console.warn(`[sidecar] backend exited (${reason})`)
      if (this.restarts < MAX_RESTARTS) {
        this.restarts += 1
        this.setStatus({
          state: 'starting',
          message: `Backend stopped (${reason}); restarting…`,
        })
        this.starting = null
        setTimeout(() => {
          void this.ready().catch((error) => {
            console.error('[sidecar] restart failed', error)
          })
        }, 750)
      } else {
        this.setStatus({
          state: 'error',
          message: `Backend stopped (${reason}). ${this.logTail.slice(-5).join(' ')}`,
        })
        this.starting = null
      }
    })

    return Promise.resolve()
  }

  private async waitForHealthy(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    let lastError = 'no response'

    while (Date.now() < deadline) {
      if (!this.child) {
        // The exit handler already recorded a more useful message.
        throw new Error(`Backend exited during startup. ${this.logTail.slice(-6).join(' ')}`)
      }
      try {
        const response = await fetch(`${this.baseUrl}/api/health`, {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(2_500),
        })
        if (response.ok) return
        lastError = `health returned HTTP ${response.status}`
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    throw new Error(`Backend did not become healthy within 45s (${lastError})`)
  }

  /** Graceful shutdown: SIGTERM, then SIGKILL after a short grace period. */
  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) {
      this.setStatus({ state: 'stopped' })
      return
    }

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        child.kill('SIGKILL')
      }, 3_000)
      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })
      child.kill('SIGTERM')
    })
    this.child = null
    this.setStatus({ state: 'stopped' })
  }

  /** Used by the renderer's "Retry" button when startup failed. */
  async restart(): Promise<BackendInfo> {
    await this.stop()
    this.restarts = 0
    this.starting = null
    return this.ready()
  }
}
