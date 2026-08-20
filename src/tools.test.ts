import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMcpFixture, type McpFixture } from '../fixtures/mcp-server.js'
import { NotFoundError, ProtocolError } from './types.js'
import type { ErpbridgeConfig } from './types.js'
import { McpClient } from './mcp.js'
import { createToolsProxy } from './tools.js'

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

const connected = async (): Promise<{ client: McpClient; tools: ReturnType<typeof createToolsProxy> }> => {
  const client = new McpClient(config())
  await client.connect()
  return { client, tools: createToolsProxy(client) }
}

describe('createToolsProxy', () => {
  it('delegates a proxy call for an exact registered name to callTool', async () => {
    const { client, tools } = await connected()
    try {
      const result = await tools.list_employees!({ limit: 10 })
      expect(result).toEqual({ result: { ok: true, tool: 'list_employees', args: { limit: 10 } }, isError: false })
    } finally {
      await client.close()
    }
  })

  it('throws NotFoundError with the available tool list for an unknown name', async () => {
    const { client, tools } = await connected()
    try {
      await expect(tools.nonexistent_tool!({})).rejects.toBeInstanceOf(NotFoundError)
      await expect(tools.nonexistent_tool!({})).rejects.toMatchObject({
        name: 'NotFoundError',
        message: expect.stringContaining('list_employees'),
      })
    } finally {
      await client.close()
    }
  })

  it('throws a ProtocolError when a required argument is missing', async () => {
    const scoped = await startMcpFixture({
      tools: [
        {
          name: 'create_employee',
          inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      ],
    })
    try {
      const client = new McpClient({ ...config(), mcpUrl: scoped.mcpUrl })
      await client.connect()
      const tools = createToolsProxy(client)
      await expect(tools.create_employee!({})).rejects.toBeInstanceOf(ProtocolError)
      await expect(tools.create_employee!({})).rejects.toMatchObject({
        name: 'ProtocolError',
        message: expect.stringContaining('name'),
      })

      const ok = await tools.create_employee!({ name: 'Ada' })
      expect(ok).toEqual({ result: { ok: true, tool: 'create_employee', args: { name: 'Ada' } }, isError: false })
      await client.close()
    } finally {
      await scoped.close()
    }
  })

  it('throws a ProtocolError when an argument has the wrong type', async () => {
    const scoped = await startMcpFixture({
      tools: [
        {
          name: 'create_employee',
          inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      ],
    })
    try {
      const client = new McpClient({ ...config(), mcpUrl: scoped.mcpUrl })
      await client.connect()
      const tools = createToolsProxy(client)
      await expect(tools.create_employee!({ name: 123 })).rejects.toBeInstanceOf(ProtocolError)
      await expect(tools.create_employee!({ name: 123 })).rejects.toMatchObject({
        name: 'ProtocolError',
        message: expect.stringContaining('string'),
      })
      await client.close()
    } finally {
      await scoped.close()
    }
  })

  it('chains dotted names through the proxy and delegates to callTool', async () => {
    const { client, tools } = await connected()
    try {
      await tools.list_employees!({})
      const result = await tools.system!.progress_test!({})
      expect(result).toMatchObject({ isError: false })
    } finally {
      await client.close()
    }
  })
})