/**
 * Surfaces backend/provider failures.
 *
 * YouTube changes break yt-dlp regularly, so the banner offers the in-app
 * "Update yt-dlp" action (pip install -U inside the app venv) and a restart for
 * a backend that failed to boot.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, resetBackend } from '../api/client'
import type { DependencyUpdateResult, HealthResponse } from '../api/types'
import type { SidecarStatus } from '../global'

export function BackendBanner() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [unreachable, setUnreachable] = useState<string | null>(null)
  const [status, setStatus] = useState<SidecarStatus | null>(null)
  const [updating, setUpdating] = useState(false)
  const [update, setUpdate] = useState<DependencyUpdateResult | null>(null)
  const [retrying, setRetrying] = useState(false)

  const check = useCallback(async () => {
    try {
      const result = await apiGet<HealthResponse>('/api/health')
      setHealth(result)
      setUnreachable(null)
    } catch (cause) {
      setHealth(null)
      setUnreachable(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void check()
    const timer = window.setInterval(() => void check(), 60_000)
    const unsubscribe = window.audifree.onBackendStatus((next) => {
      setStatus(next)
      if (next.state === 'ready') {
        resetBackend()
        void check()
      }
    })
    return () => {
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [check])

  const retry = useCallback(async () => {
    setRetrying(true)
    try {
      await window.audifree.restartBackend()
      resetBackend()
      await check()
    } catch (cause) {
      setUnreachable(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRetrying(false)
    }
  }, [check])

  const updateDependencies = useCallback(async () => {
    setUpdating(true)
    setUpdate(null)
    try {
      const result = await apiPost<DependencyUpdateResult>('/api/health/update-deps')
      setUpdate(result)
      await check()
    } catch (cause) {
      setUpdate({
        ok: false,
        output: cause instanceof Error ? cause.message : String(cause),
        versions: { yt_dlp: null, ytmusicapi: null },
      })
    } finally {
      setUpdating(false)
    }
  }, [check])

  // Backend process itself is gone / failed to boot.
  if (unreachable) {
    const starting = status?.state === 'starting'
    return (
      <div className={`banner ${starting ? 'banner--info' : 'banner--error'}`} role="alert">
        <div className="banner__body">
          <strong>{starting ? 'Starting the local backend…' : 'The local backend is not responding'}</strong>
          <span className="banner__detail">
            {starting ? 'The music service is warming up.' : unreachable}
          </span>
        </div>
        {!starting && (
          <button type="button" className="button" onClick={retry} disabled={retrying}>
            {retrying ? 'Restarting…' : 'Restart backend'}
          </button>
        )}
      </div>
    )
  }

  if (update) {
    return (
      <div className={`banner ${update.ok ? 'banner--success' : 'banner--error'}`} role="status">
        <div className="banner__body">
          <strong>{update.ok ? 'Dependencies updated' : 'Update failed'}</strong>
          <span className="banner__detail">
            yt-dlp {update.versions.yt_dlp ?? '?'} · ytmusicapi {update.versions.ytmusicapi ?? '?'}
            {update.ok && ' — restart the app if playback still fails.'}
          </span>
          <details className="banner__details">
            <summary>Show output</summary>
            <pre>{update.output || '(no output)'}</pre>
          </details>
        </div>
        <div className="banner__actions">
          {!update.ok && (
            <button type="button" className="button" onClick={updateDependencies} disabled={updating}>
              Retry update
            </button>
          )}
          <button type="button" className="button button--ghost" onClick={() => setUpdate(null)}>
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  if (health && !health.ok) {
    const versions = health.provider.versions
    return (
      <div className="banner banner--warning" role="alert">
        <div className="banner__body">
          <strong>Music service is having trouble</strong>
          <span className="banner__detail">{health.provider.error ?? 'The provider is not responding.'}</span>
          <span className="banner__detail banner__detail--muted">
            yt-dlp {versions.yt_dlp ?? 'unknown'} · ytmusicapi {versions.ytmusicapi ?? 'unknown'}
          </span>
        </div>
        <div className="banner__actions">
          <button type="button" className="button" onClick={updateDependencies} disabled={updating}>
            {updating ? 'Updating…' : 'Update yt-dlp'}
          </button>
          <button type="button" className="button button--ghost" onClick={() => void check()}>
            Recheck
          </button>
        </div>
      </div>
    )
  }

  return null
}
