import { request } from './http.js'
import type { CacheStats, ErpbridgeConfig } from './types.js'
import { ProtocolError } from './types.js'

const INTERNAL_ERROR_CODE = -32000

/** The server's health response (`GET /mcp/health`). */
export interface HealthStatus {
  status: string
}

/** Options for {@link CacheApi.flush}. */
export interface CacheFlushOptions {
  /** Flush cache entries for one tool by exact name. */
  tool?: string
  /** Flush cache entries for one module. */
  module?: string
  /** Flush the whole cache. */
  all?: true
}

/** The server's cache flush response (`GET /api/cache/flush`). */
export interface CacheFlushResult {
  /** Number of cache entries deleted. */
  deleted: number
  status: string
}

/** The cache management surface (`/api/cache/*`). */
export interface CacheApi {
  /** Return cache statistics. A disabled cache (503) surfaces as a ServerError. */
  stats(): Promise<CacheStats>
  /** Flush cache entries by tool, module, or everything. */
  flush(opts?: CacheFlushOptions): Promise<CacheFlushResult>
}

/** The server's system surface: health and cache management. */
export interface SystemApi {
  /** Return the server health status. */
  health(): Promise<HealthStatus>
  cache: CacheApi
}

/** Build the system API over the HTTP core. */
export function createSystemApi(config: ErpbridgeConfig): SystemApi {
  return {
    async health(): Promise<HealthStatus> {
      const res = await request<unknown>(config, { path: '/mcp/health' })
      if (res.body === null || typeof res.body !== 'object' || typeof (res.body as HealthStatus).status !== 'string') {
        throw new ProtocolError('invalid response from /mcp/health: expected an object with a string status', {
          code: INTERNAL_ERROR_CODE,
        })
      }
      return res.body as HealthStatus
    },

    cache: {
      async stats(): Promise<CacheStats> {
        const res = await request<unknown>(config, { path: '/api/cache/stats' })
        const stats = (res.body as { stats?: unknown } | null)?.stats
        if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) {
          throw new ProtocolError('invalid response from /api/cache/stats: missing stats envelope', {
            code: INTERNAL_ERROR_CODE,
          })
        }
        return stats as CacheStats
      },

      async flush(opts: CacheFlushOptions = {}): Promise<CacheFlushResult> {
        const query: Record<string, string | undefined> = {}
        if (opts.tool !== undefined) query.tool = opts.tool
        if (opts.module !== undefined) query.module = opts.module
        if (opts.all === true) query.all = 'true'
        const res = await request<unknown>(config, { path: '/api/cache/flush', query })
        const body = res.body as CacheFlushResult | null
        if (body === null || typeof body !== 'object' || typeof body.deleted !== 'number' || typeof body.status !== 'string') {
          throw new ProtocolError('invalid response from /api/cache/flush: expected { deleted, status }', {
            code: INTERNAL_ERROR_CODE,
          })
        }
        return body
      },
    },
  }
}