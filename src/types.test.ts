import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  AuthenticationError,
  ErpbridgeError,
  NotFoundError,
  ProtocolError,
  RateLimitError,
  ServerError,
  type CacheStats,
  type ErpbridgeConfig,
  type LogRecord,
  type MetricFamily,
  type MetricSample,
  type ToolCallArguments,
  type ToolDefinition,
  type ToolResult,
} from './types.js'

describe('error class hierarchy (D7)', () => {
  it('every typed error is an ErpbridgeError and an Error', () => {
    const errors = [
      new AuthenticationError('unauthorized'),
      new NotFoundError('missing'),
      new RateLimitError('slow down'),
      new ServerError('boom', { status: 500 }),
      new ProtocolError('bad jsonrpc', { code: -32601 }),
    ]
    for (const error of errors) {
      expect(error).toBeInstanceOf(ErpbridgeError)
      expect(error).toBeInstanceOf(Error)
    }
  })

  it('sets the concrete class name on each error', () => {
    expect(new AuthenticationError('x').name).toBe('AuthenticationError')
    expect(new NotFoundError('x').name).toBe('NotFoundError')
    expect(new RateLimitError('x').name).toBe('RateLimitError')
    expect(new ServerError('x', { status: 503 }).name).toBe('ServerError')
    expect(new ProtocolError('x', { code: -32000 }).name).toBe('ProtocolError')
    expect(new ErpbridgeError('x').name).toBe('ErpbridgeError')
  })

  it('propagates the message and cause', () => {
    const cause = new Error('underlying')
    const error = new NotFoundError('tool not found', { cause })
    expect(error.message).toBe('tool not found')
    expect(error.cause).toBe(cause)
  })

  it('attaches status and body to ServerError', () => {
    const error = new ServerError('cache not enabled', { status: 503, body: { message: 'cache not enabled' } })
    expect(error.status).toBe(503)
    expect(error.body).toEqual({ message: 'cache not enabled' })
  })

  it('attaches the JSON-RPC code to ProtocolError', () => {
    const error = new ProtocolError('unknown tool', { code: -32601 })
    expect(error.code).toBe(-32601)
  })

  it('attaches the WWW-Authenticate hint to AuthenticationError', () => {
    const error = new AuthenticationError('unauthorized', { hint: 'Bearer realm="erpbridge"' })
    expect(error.hint).toBe('Bearer realm="erpbridge"')
  })

  it('attaches Retry-After to RateLimitError', () => {
    const error = new RateLimitError('too many requests', { retryAfter: '30' })
    expect(error.retryAfter).toBe('30')
  })

  it('attaches the response body to NotFoundError', () => {
    const error = new NotFoundError('missing', { body: { error: 'no such tool' } })
    expect(error.body).toEqual({ error: 'no such tool' })
  })
})

describe('config and data types', () => {
  it('ErpbridgeConfig declares the v1 surface with inert auth fields', () => {
    expectTypeOf<ErpbridgeConfig>().toMatchTypeOf<{
      baseUrl: string
      mcpUrl: string
      timeoutMs: number
      fetch?: typeof fetch
      token?: string
      tokenEnv?: string
    }>()
  })

  it('LogRecord is lenient with an open index signature (D11)', () => {
    const record: LogRecord = { level: 'info', msg: 'hello', session_id: 's1', future_field: 42 }
    expect(record.level).toBe('info')
    expect(record.future_field).toBe(42)
  })

  it('ToolDefinition, ToolResult and ToolCallArguments have the documented shapes', () => {
    const def: ToolDefinition = { name: 'list_employees', inputSchema: { type: 'object' } }
    const result: ToolResult = { result: [1, 2], isError: false }
    const args: ToolCallArguments = { limit: 10 }
    expectTypeOf(def).toMatchTypeOf<{ name: string; description?: string; inputSchema: Record<string, unknown> }>()
    expectTypeOf(result).toMatchTypeOf<{ result: unknown; error?: string; isError?: boolean }>()
    expectTypeOf(args).toMatchTypeOf<Record<string, unknown>>()
  })

  it('CacheStats matches the server stats payload', () => {
    const stats: CacheStats = { exactKeys: 12, redisMemory: '1.2M' }
    expectTypeOf(stats).toMatchTypeOf<{ exactKeys: number; redisMemory: string }>()
  })

  it('MetricFamily and MetricSample cover counters, gauges, and histograms', () => {
    const sample: MetricSample = { labels: { method: 'GET' }, value: 3 }
    const family: MetricFamily = { name: 'erp_requests_total', type: 'counter', help: 'requests', samples: [sample] }
    expect(family.type).toBe('counter')
    expectTypeOf(sample).toMatchTypeOf<{ labels: Record<string, string>; value: number }>()
  })
})