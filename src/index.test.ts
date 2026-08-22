import type { IncomingMessage } from 'node:http'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../fixtures/http-server.js'
import { startMcpFixture, type McpFixture } from '../fixtures/mcp-server.js'
import { createClient, type ErpbridgeClient } from './index.js'
import type { McpToolResult as ClientMcpToolResult } from './client.js'
import type { RegistryTool, ToolResult } from './types.js'
import { ProtocolError } from './types.js'

let http: FixtureServer
let mcp: McpFixture

const sampleTool: RegistryTool = {
  apiVersion: 'erpbridge.io/v1',
  kind: 'MCPTool',
  metadata: { name: 'list_employees', version: '1.0.0', module: 'hr' },
  spec: {
    description: { short: 'List employees' },
    inputSchema: { type: 'object', properties: {} },
    execution: { type: 'http', method: 'GET', endpoint: 'https://erp.example/hr/employees' },
    security: { authType: 'api-key', credentialRef: 'ERP_API_KEY' },
  },
}

beforeEach(async () => {
  http = await startFixtureServer([
    { method: 'GET', path: '/api/logs/recent', body: [] },
    { method: 'GET', path: '/mcp/health', body: { status: 'ok' } },
    {
      method: 'GET',
      path: '/api/cache/stats',
      body: { apiVersion: 'v1', kind: 'CacheStats', status: 'active', stats: { exactKeys: 12, redisMemory: '1.2M' } },
    },
    { method: 'GET', path: '/apis/erpbridge.io/v1/tools', body: [sampleTool] },
    {
      method: 'POST',
      path: '/api/tools/invoke',
      body: (req: IncomingMessage, rawBody: string) => {
        const call = JSON.parse(rawBody) as { name?: string }
        return { result: { ok: true, tool: call.name } }
      },
    },
    { method: 'GET', path: '/metrics', body: '# HELP go_goroutines Number of goroutines\n# TYPE go_goroutines gauge\ngo_goroutines 7\n' },
  ])
  mcp = await startMcpFixture()
})

afterEach(async () => {
  await http.close()
  await mcp.close()
})

describe('createClient', () => {
  it('assembles the nine surfaces', () => {
    const client = createClient({ baseUrl: http.url, mcpUrl: mcp.mcpUrl })
    expect(client).toMatchObject({
      mcp: expect.any(Object),
      tools: expect.any(Object),
      registry: expect.any(Object),
      logs: expect.any(Object),
      metrics: expect.any(Object),
      health: expect.any(Function),
      cache: expect.any(Object),
      close: expect.any(Function),
    })
    expect(client.invoke).toBe(client.registry.invoke)
    expect(typeof client.mcp.connect).toBe('function')
    expect(typeof client.registry.apply).toBe('function')
  })

  it('runs MCP calls and the tool proxy through the facade', async () => {
    const client = createClient({ baseUrl: http.url, mcpUrl: mcp.mcpUrl })
    await client.mcp.connect()
    const tools = await client.mcp.listTools()
    expect(tools.map((t) => t.name)).toEqual(['list_employees', 'system.progress_test'])
    expect(await client.tools.list_employees!({ limit: 10 })).toEqual({
      content: [{ type: 'text', text: '{"ok":true,"tool":"list_employees","args":{"limit":10}}' }],
      isError: false,
    })
    await client.close()
  })

  it('runs REST capabilities through the facade', async () => {
    const client = createClient({ baseUrl: http.url, mcpUrl: mcp.mcpUrl })
    expect(await client.health()).toEqual({ status: 'ok' })
    expect(await client.cache.stats()).toEqual({ exactKeys: 12, redisMemory: '1.2M' })
    expect(await client.logs.recent()).toEqual([])
    expect(await client.registry.list()).toEqual([sampleTool])
    expect(await client.invoke('list_employees', { limit: 10 })).toEqual({ result: { ok: true, tool: 'list_employees' } })
    const parsed = await client.metrics.parsed()
    expect(parsed.families).toHaveLength(1)
    expect(parsed.families[0]).toMatchObject({ name: 'go_goroutines', type: 'gauge' })
  })

  it('close() tears down the MCP session', async () => {
    const client = createClient({ baseUrl: http.url, mcpUrl: mcp.mcpUrl })
    await client.mcp.connect()
    await client.close()
    await expect(client.mcp.listTools()).rejects.toBeInstanceOf(ProtocolError)
  })

  it('pins the ErpbridgeClient public shape', () => {
    expectTypeOf<ErpbridgeClient['invoke']>().toEqualTypeOf<
      (name: string, args: Record<string, unknown>, opts?: { role?: string }) => Promise<ToolResult>
    >()
    expectTypeOf<ErpbridgeClient['health']>().toEqualTypeOf<() => Promise<{ status: string }>>()
    expectTypeOf<ErpbridgeClient['close']>().toEqualTypeOf<() => Promise<void>>()
  })

  it('exports the MCP result type from the client subpath source', () => {
    expectTypeOf<ClientMcpToolResult>().toMatchTypeOf<{ content: readonly unknown[] }>()
  })
})
