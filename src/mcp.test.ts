import { readFileSync } from 'node:fs'
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

  it('advertises the installed package version in the handshake', async () => {
    const client = new McpClient(config())
    await client.connect()
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(fixture.lastClientInfo()).toMatchObject({ name: '@erpbridge/sdk', version })
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
    const mismatched = await startMcpFixture({
      unknownToolError: { code: -32602, message: "tool 'other_tool' not found: tool not found" },
    })
    try {
      const client = new McpClient({ ...config(), mcpUrl: mismatched.mcpUrl })
      await client.connect()
      await expect(client.callTool('nonexistent_tool', {})).rejects.toBeInstanceOf(ProtocolError)
      await expect(client.callTool('nonexistent_tool', {})).rejects.not.toBeInstanceOf(NotFoundError)
      await client.close()
    } finally {
      await mismatched.close()
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

  it('propagates an aborted request instead of reconnecting', async () => {
    const abortingFetch: typeof fetch = async (input, init) => {
      if (typeof init?.body === 'string' && init.body.includes('"tools/call"')) {
        throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
      }
      return globalThis.fetch(input, init)
    }
    const client = new McpClient({ ...config(), fetch: abortingFetch })
    await client.connect()
    expect(fixture.handshakeCount()).toBe(1)
    await expect(client.callTool('list_employees', {})).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.handshakeCount()).toBe(1)
    await client.close()
  })

  it('throws a typed error when calling before connect', async () => {
    const client = new McpClient(config())
    await expect(client.callTool('list_employees', {})).rejects.toBeInstanceOf(ProtocolError)
    await expect(client.listTools()).rejects.toBeInstanceOf(ProtocolError)
  })
})
