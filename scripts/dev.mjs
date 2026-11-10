#!/usr/bin/env node
/**
 * Development orchestrator: compile the Electron main process once, start
 * Vite, then launch Electron with VITE_DEV_SERVER_URL pointing at it.
 *
 * The Python sidecar is spawned by Electron itself, exactly like in production.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const bin = (name) => path.join(root, 'node_modules', '.bin', name)
const VITE_URL = 'http://localhost:5173'

function fail(message) {
  console.error(`\n[dev] ${message}\n`)
  process.exit(1)
}

if (!existsSync(path.join(root, 'node_modules'))) fail('Run `npm install` first.')
if (!existsSync(path.join(root, 'backend', '.venv'))) {
  fail('Python venv missing. Run `npm run setup` (or `bash scripts/setup.sh --skip-pacman`).')
}
if (!existsSync(path.join(root, 'node_modules', 'electron', 'dist', 'electron'))) {
  fail('Electron binary missing. Run `npx install-electron` (or rerun `npm install`).')
}

console.log('[dev] compiling electron main process…')
const tsc = spawnSync(bin('tsc'), ['-p', 'tsconfig.electron.json'], {
  stdio: 'inherit',
  cwd: root,
})
if (tsc.status !== 0) fail('Electron TypeScript build failed.')

const children = []
let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

const vite = spawn(bin('vite'), ['--port', '5173', '--strictPort'], {
  stdio: 'inherit',
  cwd: root,
})
children.push(vite)
vite.on('exit', (code) => {
  if (!shuttingDown) shutdown(code ?? 1)
})

async function waitForVite(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(VITE_URL)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Vite did not answer on ${VITE_URL}`)
}

try {
  await waitForVite()
} catch (error) {
  console.error(`[dev] ${error.message}`)
  shutdown(1)
}

console.log('[dev] launching Electron…')
const electron = spawn(bin('electron'), ['.'], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, VITE_DEV_SERVER_URL: VITE_URL },
})
children.push(electron)
electron.on('exit', (code) => shutdown(code ?? 0))
