import { describe, expect, it } from 'vitest'
import { ErpbridgeError } from './types.js'
import { resolveConfig, type ErpbridgeConfigInput } from './config.js'

describe('resolveConfig', () => {
  it('fills all defaults for an empty input', () => {
    const config = resolveConfig()
    expect(config.baseUrl).toBe('http://localhost:8080')
    expect(config.mcpUrl).toBe('http://localhost:8080/mcp/')
    expect(config.timeoutMs).toBe(15_000)
    expect(config.fetch).toBe(globalThis.fetch)
    expect(config.token).toBeUndefined()
    expect(config.tokenEnv).toBeUndefined()
  })

  it('derives mcpUrl from an overridden baseUrl', () => {
    const config = resolveConfig({ baseUrl: 'http://bridge.example.com:9000' })
    expect(config.mcpUrl).toBe('http://bridge.example.com:9000/mcp/')
  })

  it('keeps an explicit mcpUrl instead of deriving it', () => {
    const config = resolveConfig({ baseUrl: 'http://localhost:8080', mcpUrl: 'http://custom/mcp' })
    expect(config.mcpUrl).toBe('http://custom/mcp')
  })

  it('strips trailing slashes from baseUrl before deriving mcpUrl', () => {
    const config = resolveConfig({ baseUrl: 'http://localhost:8080///' })
    expect(config.baseUrl).toBe('http://localhost:8080')
    expect(config.mcpUrl).toBe('http://localhost:8080/mcp/')
  })

  it('honours timeoutMs and fetch overrides', () => {
    const fetchImpl = (() => {}) as unknown as typeof fetch
    const config = resolveConfig({ timeoutMs: 5000, fetch: fetchImpl })
    expect(config.timeoutMs).toBe(5000)
    expect(config.fetch).toBe(fetchImpl)
  })

  it('retains auth input alongside normalized credentials', () => {
    const config = resolveConfig({
      token: 'abc',
      tokenEnv: 'ERPBRIDGE_TOKEN',
      declaredScopes: ['mcp'],
      auth: { logs: { token: 'logs-token', declaredScopes: ['logs'] } },
    })
    expect(config.token).toBe('abc')
    expect(config.tokenEnv).toBe('ERPBRIDGE_TOKEN')
    expect(config.declaredScopes).toEqual(['mcp'])
    expect(config.auth).toEqual({ logs: { token: 'logs-token', declaredScopes: ['logs'] } })
  })

  it('resolves ERPBRIDGE_TOKEN internally without exposing the bearer value', () => {
    const previous = process.env.ERPBRIDGE_TOKEN
    process.env.ERPBRIDGE_TOKEN = 'sdk-default-env-token'
    try {
      const config = resolveConfig()
      expect(config).not.toHaveProperty('resolvedAuth')
    } finally {
      if (previous === undefined) delete process.env.ERPBRIDGE_TOKEN
      else process.env.ERPBRIDGE_TOKEN = previous
    }
  })

  it('rejects a malformed baseUrl early', () => {
    expect(() => resolveConfig({ baseUrl: 'not a url' })).toThrow(ErpbridgeError)
  })
})

describe('ErpbridgeConfigInput type', () => {
  it('accepts only the documented input fields', () => {
    const input: ErpbridgeConfigInput = {
      baseUrl: 'http://x',
      mcpUrl: 'http://y/mcp',
      timeoutMs: 100,
      fetch: undefined,
      token: undefined,
      tokenEnv: undefined,
      declaredScopes: ['mcp'],
      auth: { mcp: { token: 'secret' } },
    }
    expect(input.baseUrl).toBe('http://x')
  })
})
