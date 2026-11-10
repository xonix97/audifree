/**
 * Thin fetch wrapper around the local FastAPI sidecar.
 *
 * The renderer never sees the port or token: Electron hands both over through
 * the preload bridge, and every request carries the bearer token.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean

  constructor(message: string, status: number, code = 'error', retryable = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

export interface BackendInfo {
  baseUrl: string
  token: string
}

let backendPromise: Promise<BackendInfo> | null = null

export function getBackend(): Promise<BackendInfo> {
  if (!backendPromise) {
    backendPromise = window.audifree.getBackend().catch((error: unknown) => {
      backendPromise = null
      throw error
    })
  }
  return backendPromise
}

/** Forget the cached port/token; used after the sidecar restarts. */
export function resetBackend(): void {
  backendPromise = null
}

export type QueryValue = string | number | boolean | undefined | null

function buildUrl(baseUrl: string, path: string, params?: Record<string, QueryValue>): string {
  const url = new URL(path, baseUrl)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function request<T>(path: string, init: RequestInit = {}, params?: Record<string, QueryValue>): Promise<T> {
  const { baseUrl, token } = await getBackend()
  let response: Response
  try {
    response = await fetch(buildUrl(baseUrl, path, params), {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    throw new ApiError(
      `Cannot reach the local backend. ${error instanceof Error ? error.message : String(error)}`,
      0,
      'backend_unreachable',
      true,
    )
  }

  if (!response.ok) {
    let detail = `Request failed (HTTP ${response.status})`
    let code = 'http_error'
    let retryable = response.status >= 500
    try {
      const payload = (await response.json()) as { detail?: string; code?: string; retryable?: boolean }
      if (payload.detail) detail = payload.detail
      if (payload.code) code = payload.code
      if (typeof payload.retryable === 'boolean') retryable = payload.retryable
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    throw new ApiError(detail, response.status, code, retryable)
  }

  return (await response.json()) as T
}

export function apiGet<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
  return request<T>(path, { method: 'GET' }, params)
}

/** POST; pass a body to send JSON, or omit it for body-less actions. */
export function apiPost<T>(
  path: string,
  body?: unknown,
  params?: Record<string, QueryValue>,
): Promise<T> {
  return request<T>(
    path,
    body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) },
    params,
  )
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}
