import { INTERNAL_ERROR_CODE, protocolError } from './errors.js'
import { request, requestStream } from './http.js'
import type { ErpbridgeConfig, LogRecord } from './types.js'
import { parseSse } from './sse.js'

const DEFAULT_RECONNECT_DELAY_MS = 250

/** Options for {@link LogsApi.stream}. */
export interface LogStreamOptions {
  /** Fire to end the stream: the iterator stops reconnecting and finishes. */
  signal?: AbortSignal
  /** Delay between reconnect attempts after the connection drops. Default 250ms. */
  reconnectDelayMs?: number
}

/** The server's logs REST surface (`/api/logs/*`). */
export interface LogsApi {
  /** Return the most recent buffered log records. */
  recent(): Promise<LogRecord[]>
  /**
   * Stream log records over SSE (`data: <json>\n\n`). The stream reconnects
   * automatically — including across failed connection attempts — until the
   * provided `signal` fires; records are yielded in arrival order.
   */
  stream(opts?: LogStreamOptions): AsyncIterable<LogRecord>
}

/** Build the logs API over the HTTP core. */
export function createLogsApi(config: ErpbridgeConfig): LogsApi {
  return {
    async recent(): Promise<LogRecord[]> {
      const res = await request<unknown>(config, { path: '/api/logs/recent' })
      if (!Array.isArray(res.body)) {
        throw protocolError('invalid response from /api/logs/recent: expected an array of log records')
      }
      return res.body as LogRecord[]
    },

    stream(opts: LogStreamOptions = {}): AsyncIterable<LogRecord> {
      const { signal, reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS } = opts

      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<LogRecord> {
          const internal = new AbortController()
          const combined = signal ? AbortSignal.any([signal, internal.signal]) : internal.signal
          const aborted = (): boolean => combined.aborted
          const sleep = (): Promise<void> =>
            new Promise((resolve) => {
              const onAbort = (): void => {
                clearTimeout(timer)
                resolve()
              }
              const timer = setTimeout(() => {
                combined.removeEventListener('abort', onAbort)
                resolve()
              }, reconnectDelayMs)
              combined.addEventListener('abort', onAbort, { once: true })
            })

          try {
            for (;;) {
              if (aborted()) return
              try {
                const res = await requestStream(config, { path: '/api/logs/stream', noTimeout: true, signal: combined })
                if (res.body === null) {
                  throw protocolError('empty SSE response body from /api/logs/stream')
                }
                for await (const payload of parseSse(res.body)) {
                  if (aborted()) return
                  let record: LogRecord
                  try {
                    record = JSON.parse(payload) as LogRecord
                  } catch {
                    continue
                  }
                  yield record
                }
              } catch {
                // Transport failure: reconnect after the delay unless aborted.
              }
              await sleep()
            }
          } finally {
            internal.abort()
          }
        },
      }
    },
  }
}