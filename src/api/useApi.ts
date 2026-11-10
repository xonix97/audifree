import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiGet, type QueryValue } from './client'

/**
 * Minimal data-fetching hook: one GET, abort on unmount/dep change, manual
 * reload. The app's data set is small enough that this beats a query library.
 */
export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: ApiError | null
  reload: () => void
}

export function useApi<T>(
  path: string | null,
  params?: Record<string, QueryValue>,
  /** Bump to refetch after an out-of-band mutation (library changes). */
  refreshKey = 0,
): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [error, setError] = useState<ApiError | null>(null)
  const [nonce, setNonce] = useState(0)

  // Serialise params so a fresh object literal does not refetch every render.
  const paramsKey = JSON.stringify(params ?? {})

  useEffect(() => {
    if (!path) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    apiGet<T>(path, JSON.parse(paramsKey) as Record<string, QueryValue>)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError(cause instanceof Error ? cause.message : String(cause), 0),
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [path, paramsKey, nonce, refreshKey])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, loading, error, reload }
}
