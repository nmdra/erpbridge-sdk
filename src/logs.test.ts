import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startLogsSseFixture, type LogsSseFixture } from '../fixtures/logs-sse.js'
import { AuthorizationError, ProtocolError } from './types.js'
import type { ErpbridgeConfig, LogRecord } from './types.js'
import { createLogsApi } from './logs.js'

let fixture: LogsSseFixture

const logs: LogRecord[] = [
  { time: '2026-08-20T10:00:00Z', level: 'INFO', msg: 'server started' },
  { time: '2026-08-20T10:00:01Z', level: 'INFO', msg: 'tool called', tool_name: 'list_employees' },
  { time: '2026-08-20T10:00:02Z', level: 'WARN', msg: 'slow request', request_id: 'req-1' },
]

const config = (): ErpbridgeConfig => ({
  baseUrl: fixture.url,
  mcpUrl: `${fixture.url}/mcp/`,
  timeoutMs: 5000,
  fetch: globalThis.fetch,
})

beforeEach(async () => {
  fixture = await startLogsSseFixture({ recentLogs: logs, events: logs, intervalMs: 5 })
})

afterEach(async () => {
  await fixture.close()
})

const collect = async <T>(iter: AsyncIterable<T>, count: number, timeoutMs = 2000): Promise<T[]> => {
  const out: T[] = []
  const deadline = Date.now() + timeoutMs
  for await (const record of iter) {
    out.push(record)
    if (out.length >= count) return out
    if (Date.now() > deadline) throw new Error(`timed out after ${out.length} records`)
  }
  return out
}

describe('createLogsApi', () => {
  it('recent() returns the LogRecord array', async () => {
    const api = createLogsApi(config())
    const recent = await api.recent()
    expect(recent).toEqual(logs)
    expect(recent[0]).toMatchObject({ level: 'INFO', msg: 'server started' })
  })

  it('uses the logs surface credential for recent and SSE requests', async () => {
    const scoped = await startLogsSseFixture({ recentLogs: logs, events: logs, intervalMs: 5, closeAfterEmitted: 1 })
    try {
      const api = createLogsApi({ ...config(), baseUrl: scoped.url, auth: { logs: { token: 'sdk-logs-fixture-token' } } })
      await api.recent()
      await collect(api.stream({ reconnectDelayMs: 10 }), 2)
      expect(scoped.authorizationHeaders()).toEqual([
        'Bearer sdk-logs-fixture-token',
        'Bearer sdk-logs-fixture-token',
        'Bearer sdk-logs-fixture-token',
      ])
    } finally {
      await scoped.close()
    }
  })

  it('recent() throws a typed error for a non-array response body', async () => {
    const scoped = await startLogsSseFixture({ recentBody: { error: 'not an array' } })
    try {
      const api = createLogsApi({ ...config(), baseUrl: scoped.url })
      await expect(api.recent()).rejects.toBeInstanceOf(ProtocolError)
    } finally {
      await scoped.close()
    }
  })

  it('stream() emits records from the fixture SSE in order', async () => {
    const api = createLogsApi(config())
    const records = await collect(api.stream({ reconnectDelayMs: 10 }), 3)
    expect(records).toEqual(logs)
  })

  it('stream() reconnects after the server closes the connection', async () => {
    const scoped = await startLogsSseFixture({ recentLogs: logs, events: logs, intervalMs: 5, closeAfterEmitted: 2 })
    try {
      const api = createLogsApi({ ...config(), baseUrl: scoped.url })
      const records = await collect(api.stream({ reconnectDelayMs: 10 }), 3)
      expect(records.length).toBe(3)
      expect(scoped.connections()).toBe(2)
    } finally {
      await scoped.close()
    }
  })

  it('stream() reconnects after a failed connection attempt', async () => {
    let fail = true
    const scoped = await startLogsSseFixture({
      recentLogs: logs,
      events: logs,
      intervalMs: 5,
      shouldFail: () => {
        if (fail) {
          fail = false
          return true
        }
        return false
      },
    })
    try {
      const api = createLogsApi({ ...config(), baseUrl: scoped.url })
      const records = await collect(api.stream({ reconnectDelayMs: 10 }), 2)
      expect(records).toEqual(logs.slice(0, 2))
      expect(scoped.connections()).toBe(2)
    } finally {
      await scoped.close()
    }
  })

  it('propagates SSE authorization failures instead of reconnecting', async () => {
    const scoped = await startLogsSseFixture({ streamFailure: { status: 403, body: { error: 'forbidden' } } })
    try {
      const api = createLogsApi({ ...config(), baseUrl: scoped.url })
      const controller = new AbortController()
      const iterator = api.stream({ signal: controller.signal, reconnectDelayMs: 10 })[Symbol.asyncIterator]()
      const pending = iterator.next()
      setTimeout(() => controller.abort(), 50)
      await expect(pending).rejects.toMatchObject({ name: 'AuthorizationError', status: 403 })
      expect(scoped.connections()).toBe(1)
    } finally {
      await scoped.close()
    }
  })

  it('stream() ends cleanly when aborted after emitting records', async () => {
    const api = createLogsApi(config())
    const controller = new AbortController()
    const iter = api.stream({ signal: controller.signal, reconnectDelayMs: 10 })
    const first = iter[Symbol.asyncIterator]()
    const firstResult = await first.next()
    expect(firstResult.done).toBe(false)
    controller.abort()
    const rest = await collect({ [Symbol.asyncIterator]: () => first }, 10, 300)
    expect(rest.length).toBe(0)
  })

  it('stream() ends cleanly when aborted before any event', async () => {
    const api = createLogsApi(config())
    const controller = new AbortController()
    const iter = api.stream({ signal: controller.signal, reconnectDelayMs: 10 })
    const first = iter[Symbol.asyncIterator]()
    const pending = first.next()
    controller.abort()
    const result = await pending
    expect(result.done).toBe(true)
  })

  it('stream() aborts promptly on a hung connection after abort fires', async () => {
    const hung = await startLogsSseFixture({ recentLogs: [], events: [], intervalMs: 60000 })
    try {
      const api = createLogsApi({ ...config(), baseUrl: hung.url })
      const controller = new AbortController()
      const iter = api.stream({ signal: controller.signal, reconnectDelayMs: 10 })
      const first = iter[Symbol.asyncIterator]()
      const pending = first.next()
      setTimeout(() => controller.abort(), 20)
      const result = await pending
      expect(result.done).toBe(true)
    } finally {
      await hung.close()
    }
  })
})
