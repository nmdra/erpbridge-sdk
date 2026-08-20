import type { IncomingMessage } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../fixtures/http-server.js'
import type { ErpbridgeConfig } from './types.js'
import { ProtocolError, ServerError } from './types.js'
import { createSystemApi } from './system.js'

let fixture: FixtureServer

const config = (): ErpbridgeConfig => ({
  baseUrl: fixture.url,
  mcpUrl: `${fixture.url}/mcp/`,
  timeoutMs: 5000,
  fetch: globalThis.fetch,
})

beforeEach(async () => {
  fixture = await startFixtureServer([
    { method: 'GET', path: '/mcp/health', body: { status: 'ok' } },
    {
      method: 'GET',
      path: '/api/cache/stats',
      body: { apiVersion: 'v1', kind: 'CacheStats', status: 'active', stats: { exactKeys: 12, redisMemory: '1.2M' } },
    },
    {
      method: 'GET',
      path: '/api/cache/flush',
      body: (req: IncomingMessage) => {
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams
        if (query.get('tool') === 'list_employees') return { deleted: 2, status: 'ok' }
        if (query.get('module') === 'hr') return { deleted: 5, status: 'ok' }
        if (query.get('all') === 'true') return { deleted: 99, status: 'ok' }
        return { error: 'missing tool, module or all parameter' }
      },
      status: (req: IncomingMessage) => {
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams
        return query.has('tool') || query.has('module') || query.get('all') === 'true' ? 200 : 400
      },
    },
  ])
})

afterEach(async () => {
  await fixture.close()
})

describe('createSystemApi', () => {
  it('health() returns the documented status shape', async () => {
    const api = createSystemApi(config())
    expect(await api.health()).toEqual({ status: 'ok' })
  })

  it('health() throws a typed error for a malformed body', async () => {
    const scoped = await startFixtureServer([{ method: 'GET', path: '/mcp/health', body: { unexpected: true } }])
    try {
      const api = createSystemApi({ ...config(), baseUrl: scoped.url })
      await expect(api.health()).rejects.toBeInstanceOf(ProtocolError)
    } finally {
      await scoped.close()
    }
  })

  it('cache.stats() unwraps the envelope into CacheStats', async () => {
    const api = createSystemApi(config())
    expect(await api.cache.stats()).toEqual({ exactKeys: 12, redisMemory: '1.2M' })
  })

  it('cache.stats() throws a typed error for a missing stats envelope', async () => {
    const scoped = await startFixtureServer([{ method: 'GET', path: '/api/cache/stats', body: { kind: 'CacheStats' } }])
    try {
      const api = createSystemApi({ ...config(), baseUrl: scoped.url })
      await expect(api.cache.stats()).rejects.toBeInstanceOf(ProtocolError)
    } finally {
      await scoped.close()
    }
  })

  it('cache.stats() maps a disabled cache (503) to ServerError', async () => {
    const scoped = await startFixtureServer([{ method: 'GET', path: '/api/cache/stats', status: 503, body: 'cache not enabled\n' }])
    try {
      const api = createSystemApi({ ...config(), baseUrl: scoped.url })
      await expect(api.cache.stats()).rejects.toBeInstanceOf(ServerError)
      await expect(api.cache.stats()).rejects.toMatchObject({
        name: 'ServerError',
        status: 503,
        message: 'cache not enabled',
      })
    } finally {
      await scoped.close()
    }
  })

  it('cache.flush({ tool }) sends the tool query and returns the deleted count', async () => {
    const api = createSystemApi(config())
    expect(await api.cache.flush({ tool: 'list_employees' })).toEqual({ deleted: 2, status: 'ok' })
  })

  it('cache.flush({ module }) sends the module query', async () => {
    const api = createSystemApi(config())
    expect(await api.cache.flush({ module: 'hr' })).toEqual({ deleted: 5, status: 'ok' })
  })

  it('cache.flush({ all: true }) sends all=true', async () => {
    const api = createSystemApi(config())
    expect(await api.cache.flush({ all: true })).toEqual({ deleted: 99, status: 'ok' })
  })

  it('cache.flush() without a target passes through the server 400', async () => {
    const api = createSystemApi(config())
    await expect(api.cache.flush()).rejects.toMatchObject({
      name: 'ServerError',
      status: 400,
      message: 'missing tool, module or all parameter',
    })
  })

  it('cache.flush() throws a typed error for a malformed body', async () => {
    const scoped = await startFixtureServer([{ method: 'GET', path: '/api/cache/flush', body: { nope: true } }])
    try {
      const api = createSystemApi({ ...config(), baseUrl: scoped.url })
      await expect(api.cache.flush({ all: true })).rejects.toBeInstanceOf(ProtocolError)
    } finally {
      await scoped.close()
    }
  })

  it('cache.flush() maps a disabled cache (503) to ServerError', async () => {
    const scoped = await startFixtureServer([{ method: 'GET', path: '/api/cache/flush', status: 503, body: 'cache not enabled\n' }])
    try {
      const api = createSystemApi({ ...config(), baseUrl: scoped.url })
      await expect(api.cache.flush({ all: true })).rejects.toBeInstanceOf(ServerError)
      await expect(api.cache.flush({ all: true })).rejects.toMatchObject({
        name: 'ServerError',
        status: 503,
        message: 'cache not enabled',
      })
    } finally {
      await scoped.close()
    }
  })
})