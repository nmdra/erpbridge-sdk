import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMcpFixture, type McpFixture } from '../fixtures/mcp-server.js'
import type { ErpbridgeConfig, ToolResult } from './types.js'
import { NotFoundError, ProtocolError } from './types.js'
import { McpClient } from './mcp.js'

let fixture: McpFixture

const config = (timeoutMs = 5000): ErpbridgeConfig => ({
  baseUrl: 'http://127.0.0.1:1',
  mcpUrl: fixture.mcpUrl,
  timeoutMs,
  fetch: globalThis.fetch,
})

beforeEach(async () => {
  fixture = await startMcpFixture()
})

afterEach(async () => {
  await fixture.close()
})

describe('McpClient', () => {
  it('connects, negotiates, and lists tools as ToolDefinitions', async () => {
    const client = new McpClient(config())
    await client.connect()
    const tools = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['list_employees', 'system.progress_test'])
    expect(tools[0]).toMatchObject({
      name: 'list_employees',
      description: 'List employees',
      inputSchema: { type: 'object' },
    })
    await client.close()
  })

  it('calls a known tool and maps its content to the ToolResult', async () => {
    const client = new McpClient(config())
    await client.connect()
    const result = await client.callTool('list_employees', { limit: 10 })
    expect(result).toEqual({ result: { ok: true, tool: 'list_employees', args: { limit: 10 } }, isError: false })
    await client.close()
  })

  it('returns ToolResult with isError true for server-recognized execution failures', async () => {
    const failing = await startMcpFixture({
      tools: [{ name: 'flaky', failWith: 'boom: backend down' }],
    })
    try {
      const client = new McpClient({ ...config(), mcpUrl: failing.mcpUrl })
      await client.connect()
      const result = await client.callTool('flaky', {})
      expect(result.isError).toBe(true)
      expect(String(result.result)).toContain('backend down')
      await client.close()
    } finally {
      await failing.close()
    }
  })

  it('maps the unknown-tool protocol error to NotFoundError', async () => {
    const client = new McpClient(config())
    await client.connect()
    await expect(client.callTool('nonexistent_tool', {})).rejects.toBeInstanceOf(NotFoundError)
    await expect(client.callTool('nonexistent_tool', {})).rejects.toMatchObject({
      name: 'NotFoundError',
      message: expect.stringContaining('not found'),
    })
    await client.close()
  })

  it('does not map a mismatched not-found message to NotFoundError', async () => {
    const { createServer } = await import('node:http')
    const { readBody } = await import('../fixtures/helpers.js')
    let sessionId: string | undefined
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/.well-known/oauth-protected-resource') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'not found' }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/mcp/') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(': connected\n\n')
        return
      }
      if (req.method !== 'POST' || url.pathname !== '/mcp/') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      const raw = await readBody(req as import('node:http').IncomingMessage)
      const msg = JSON.parse(raw) as { id?: unknown; method?: string; params?: Record<string, unknown> }
      if (msg.method === 'initialize') {
        sessionId = 'sess-test'
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Mcp-Session-Id': sessionId })
        res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'test', version: '0.0.0' } } })}\n\n`)
        return
      }
      if (msg.method === 'notifications/initialized') {
        res.writeHead(202)
        res.end()
        return
      }
      if (msg.method === 'tools/call') {
        // Intentionally mention a *different* tool name than the one the client asked for.
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: "tool 'other_tool' not found: tool not found" } })}\n\n`)
        return
      }
      if (msg.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'my_tool', description: 'x', inputSchema: { type: 'object' } }] } })}\n\n`)
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })}\n\n`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as import('node:net').AddressInfo
    const mcpUrl = `http://127.0.0.1:${address.port}/mcp/`
    try {
      const client = new McpClient({ baseUrl: 'http://127.0.0.1:1', mcpUrl, timeoutMs: 5000, fetch: globalThis.fetch })
      await client.connect()
      await expect(client.callTool('my_tool', {})).rejects.toBeInstanceOf(ProtocolError)
      await expect(client.callTool('my_tool', {})).rejects.not.toBeInstanceOf(NotFoundError)
      await client.close()
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    }
  })

  it('reconnects once with a fresh session after a transport failure, then succeeds', async () => {
    const expiring = await startMcpFixture({ expireAfterRequests: 1 })
    try {
      const client = new McpClient({ ...config(), mcpUrl: expiring.mcpUrl })
      await client.connect()
      await client.listTools()
      expect(expiring.handshakeCount()).toBe(1)

      const result = await client.callTool('list_employees', {})
      expect(result).toMatchObject({ isError: false })
      expect(expiring.handshakeCount()).toBe(2)
      await client.close()
    } finally {
      await expiring.close()
    }
  })

  it('throws ProtocolError when a second reconnect would be needed', async () => {
    const expiring = await startMcpFixture({ expireAfterRequests: 0 })
    try {
      const client = new McpClient({ ...config(), mcpUrl: expiring.mcpUrl })
      await client.connect()

      // Every tools request expires its session: one reconnect (handshake 2),
      // the retry fails again, and the operation throws ProtocolError.
      await expect(client.callTool('list_employees', {})).rejects.toBeInstanceOf(ProtocolError)
      expect(expiring.handshakeCount()).toBe(2)
      await client.close()
    } finally {
      await expiring.close()
    }
  })

  it('throws a typed error when calling before connect', async () => {
    const client = new McpClient(config())
    await expect(client.callTool('list_employees', {})).rejects.toBeInstanceOf(ProtocolError)
    await expect(client.listTools()).rejects.toBeInstanceOf(ProtocolError)
  })
})