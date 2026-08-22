import { describe, expect, it } from 'vitest'
import { createClient, type ErpbridgeClient } from '../../src/index.js'
import type { LogRecord, RegistryTool } from '../../src/types.js'
import { ServerError } from '../../src/types.js'

const serverUrl = process.env.ERPBridge_TEST_SERVER
const integration = serverUrl ? describe : describe.skip

function makeClient(timeoutMs = 15_000): ErpbridgeClient {
  return createClient({ baseUrl: serverUrl!, timeoutMs })
}

// Probed at collection time (runIf is evaluated when the test is defined).
let seeded = false
if (serverUrl) {
  const probe = makeClient()
  await probe.mcp.connect()
  seeded = (await probe.mcp.listTools()).some((t) => t.name === 'list_employees')
  await probe.close()
}

integration('ERPBridge live integration (happy paths)', () => {
  it('health() reports ok', async () => {
    const client = makeClient()
    expect(await client.health()).toEqual({ status: 'ok' })
  })

  it('mcp.connect() + listTools() includes the built-in tools', async () => {
    const client = makeClient()
    await client.mcp.connect()
    const names = (await client.mcp.listTools()).map((t) => t.name)
    expect(names).toContain('system.progress_test')
    expect(names).toContain('system.sensitive_log_test')
    await client.close()
  })

  it('mcp.callTool("system.progress_test") returns an MCP result envelope', async () => {
    const client = makeClient()
    await client.mcp.connect()
    const result = await client.mcp.callTool('system.progress_test', { steps: 1 })
    expect(result.isError).toBe(false)
    // Live server wraps tool text results in a text content block.
    expect(JSON.stringify(result.content)).toContain('Finished 1 steps successfully')
    await client.close()
  })

  it.runIf(seeded)('tools.<name>() proxy calls a seeded tool', async () => {
    const client = makeClient()
    await client.mcp.connect()
    const result = await client.tools.list_employees!({})
    expect(result.isError).toBe(false)
    expect(Array.isArray(result.content)).toBe(true)
    await client.close()
  })

  it('invoke() works over REST for a seeded tool', async () => {
    const client = makeClient()
    // Built-in `system.*` tools resolve only through the MCP tool table; the
    // REST invoke path resolves registered (stored) tools only.
    const result = await client.invoke('list_employees', {})
    expect(result.isError).toBeFalsy()
    expect(result.result).toBeDefined()
  })

  it('logs.recent() returns records after tool calls', async () => {
    const client = makeClient()
    await client.invoke('list_employees', {})
    const records = await client.logs.recent()
    expect(Array.isArray(records)).toBe(true)
    expect(records.length).toBeGreaterThan(0)
    expect(records[0]).toHaveProperty('level')
  })

  it('logs.stream() emits at least one record and aborts cleanly', async () => {
    const client = makeClient()
    const ac = new AbortController()
    const seen: LogRecord[] = []
    const stream = (async () => {
      for await (const rec of client.logs.stream({ signal: ac.signal })) {
        seen.push(rec)
        if (seen.length >= 1) ac.abort()
      }
    })()
    await client.invoke('list_employees', {})
    await Promise.race([
      stream,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('stream emitted no record within 10s')), 10_000),
      ),
    ])
    expect(seen.length).toBeGreaterThanOrEqual(1)
  })

  it('metrics.text() contains the tool invocation counter after a call', async () => {
    const client = makeClient()
    await client.invoke('list_employees', {})
    const text = await client.metrics.text()
    expect(text).toContain('mcp_tool_invocations_total')
  })

  it('metrics.parsed() includes counter and histogram families', async () => {
    const client = makeClient()
    await client.invoke('list_employees', {})
    const parsed = await client.metrics.parsed()
    const types = new Map(parsed.families.map((f) => [f.name, f.type]))
    expect(types.get('mcp_tool_invocations_total')).toBe('counter')
    expect(types.get('mcp_tool_duration_seconds')).toBe('histogram')
  })

  it('cache.stats() returns CacheStats, or ServerError when cache is disabled', async () => {
    const client = makeClient()
    try {
      const stats = await client.cache.stats()
      expect(typeof stats.exactKeys).toBe('number')
      expect(typeof stats.redisMemory).toBe('string')
    } catch (error) {
      expect(error).toBeInstanceOf(ServerError)
      expect((error as ServerError).status).toBe(503)
    }
  })

  it('registry.list() returns the seeded tools', async () => {
    const client = makeClient()
    const tools = await client.registry.list()
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.some((t) => t.metadata.name === 'list_employees')).toBe(true)
  })

  it('registry.apply() + delete() round-trips a tool', async () => {
    const client = makeClient()
    const name = 'sdk_integration_probe'
    const version = '1.0.0'
    const def: RegistryTool = {
      apiVersion: 'erpbridge.io/v1',
      kind: 'MCPTool',
      metadata: { name, version, module: 'sdk-test' },
      spec: {
        description: { short: 'SDK integration probe' },
        inputSchema: { type: 'object', properties: {} },
        execution: { type: 'http', method: 'GET', endpoint: 'http://mock-erp:8081/health' },
        security: { authType: 'api-key', credentialRef: 'ERP_PRIMARY_KEY' },
      },
    }
    const applied = await client.registry.apply(def)
    expect(applied).toMatchObject({ status: 'applied', name, version })
    try {
      const tools = await client.registry.list()
      expect(tools.some((t) => t.metadata.name === name && t.metadata.version === version)).toBe(true)
    } finally {
      await client.registry.delete(name, version, { hard: true })
    }
    const after = await client.registry.list()
    expect(after.some((t) => t.metadata.name === name && t.metadata.version === version)).toBe(false)
  })
})
