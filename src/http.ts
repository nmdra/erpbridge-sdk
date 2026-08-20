import type { ErpbridgeConfig } from './types.js'
import { AuthenticationError, ErpbridgeError, NotFoundError, RateLimitError, ServerError } from './types.js'

/** A request against the ERPBridge server. */
export interface HttpRequest {
  /** HTTP method. Defaults to `GET`. */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
  /** Absolute path below `baseUrl`, e.g. `/api/logs/recent`. */
  path: string
  /** Query parameters; entries with `undefined` values are omitted. */
  query?: Record<string, string | undefined>
  /** JSON-serializable request body. */
  body?: unknown
  /** Extra headers to send. */
  headers?: Record<string, string>
  /** External abort signal (e.g. from a caller's AbortController). */
  signal?: AbortSignal
  /** Skip the per-request timeout (long-lived streams, e.g. SSE). */
  noTimeout?: boolean
}

/** A decoded JSON response from the server. */
export interface HttpResponse<T = unknown> {
  /** HTTP status code. */
  status: number
  /** Response headers. */
  headers: Headers
  /** Parsed JSON body, the raw text for non-JSON responses, or `""` when empty. */
  body: T
}

/**
 * Perform a JSON request against the server and map failures into the
 * typed error tree (D7). Non-2xx responses throw the matching error class
 * with the response body attached.
 */
export async function request<T = unknown>(config: ErpbridgeConfig, req: HttpRequest): Promise<HttpResponse<T>> {
  const res = await requestStream(config, req)
  const text = await res.text()
  const body = parseBody(text)
  if (!res.ok) throw mapHttpError(res, body)
  return { status: res.status, headers: res.headers, body: body as T }
}

/**
 * Perform a request and return the raw {@link Response} for streaming
 * consumers (e.g. SSE). HTTP error statuses still throw the mapped error.
 */
export async function requestStream(config: ErpbridgeConfig, req: HttpRequest): Promise<Response> {
  const url = buildUrl(config.baseUrl, req.path, req.query)
  const headers = new Headers(req.headers)
  if (req.body !== undefined) headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json, text/event-stream')

  const timeoutSignal = req.noTimeout ? undefined : AbortSignal.timeout(config.timeoutMs)
  const signal = req.signal ? (timeoutSignal ? AbortSignal.any([timeoutSignal, req.signal]) : req.signal) : timeoutSignal

  let res: Response
  try {
    res = await (config.fetch ?? globalThis.fetch)(url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal,
    })
  } catch (error) {
    throw toTimeoutOrAbortError(error, config.timeoutMs, req.signal)
  }

  if (!res.ok) {
    const text = await res.text()
    throw mapHttpError(res, parseBody(text))
  }
  return res
}

/** Build an absolute URL from the base URL, path, and query parameters. */
export function buildUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(path, `${baseUrl}/`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
  }
  return url.href
}

function mapHttpError(res: Response, body: unknown): ErpbridgeError {
  const status = res.status
  const message = errorMessage(status, body)
  if (status === 401) {
    return new AuthenticationError(message, {
      status,
      body,
      hint: res.headers.get('www-authenticate') ?? undefined,
    })
  }
  if (status === 404) {
    return new NotFoundError(message, { status, body })
  }
  if (status === 429) {
    return new RateLimitError(message, {
      status,
      body,
      retryAfter: res.headers.get('retry-after') ?? undefined,
    })
  }
  return new ServerError(message, { status, body })
}

function errorMessage(status: number, body: unknown): string {
  if (typeof body === 'string' && body) return body.trim()
  if (body && typeof body === 'object') {
    const candidate = (body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message
    if (typeof candidate === 'string') return candidate
  }
  return `request failed with HTTP ${status}`
}

function parseBody(text: string): unknown {
  if (!text) return ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toTimeoutOrAbortError(error: unknown, timeoutMs: number, userSignal?: AbortSignal): ErpbridgeError {
  if (userSignal?.aborted) {
    return new ErpbridgeError('request aborted', { cause: error })
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new ErpbridgeError(`request timed out after ${timeoutMs}ms`, { cause: error })
  }
  return new ErpbridgeError(`request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
}