import { describe, expect, it } from 'vitest'
import { createClient, type ErpbridgeClient } from '../../src/index.js'
import { AuthenticationError, AuthorizationError } from '../../src/types.js'

const serverUrl = process.env.ERPBridge_TEST_SERVER
const adminToken = process.env.ERPBridge_TEST_ADMIN_TOKEN
const mcpToken = process.env.ERPBridge_TEST_MCP_TOKEN
const metricsToken = process.env.ERPBridge_TEST_METRICS_TOKEN
const logsToken = process.env.ERPBridge_TEST_LOGS_TOKEN

// These values are provisioned by the live-server operator. The SDK never
// creates, prints, persists, or otherwise exposes any credential.
const authReady = Boolean(serverUrl && adminToken && mcpToken && metricsToken && logsToken)
const authIntegration = authReady ? describe : describe.skip
const toolName = process.env.ERPBridge_TEST_TOOL_NAME ?? 'list_employees'
const guardedToolName = process.env.ERPBridge_TEST_GUARDED_TOOL
const guardedRole = process.env.ERPBridge_TEST_ROLE
const guardedArguments = parseArguments(process.env.ERPBridge_TEST_GUARDED_ARGUMENTS_JSON)
const guardedIntegration = authReady && guardedToolName && guardedRole && guardedArguments ? describe : describe.skip

function makeClient(token?: string): ErpbridgeClient {
  return createClient({ baseUrl: serverUrl!, token, timeoutMs: 15_000 })
}

function makeAnonymousClient(): ErpbridgeClient {
  // An explicit empty tokenEnv disables the default ERPBridge_TOKEN fallback.
  return createClient({ baseUrl: serverUrl!, tokenEnv: '', timeoutMs: 15_000 })
}

function parseArguments(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

authIntegration('ERPBridge live integration (authenticated release contract)', () => {
  it('uses an externally provisioned scoped credential on MCP, metrics, and logs', async () => {
    const mcp = makeClient(mcpToken)
    await mcp.mcp.connect()
    const tools = await mcp.mcp.listTools()
    expect(tools.some((tool) => tool.name === 'system.progress_test')).toBe(true)
    await mcp.close()

    const metrics = makeClient(metricsToken)
    expect(await metrics.metrics.text()).toContain('mcp_tool_invocations_total')

    const logs = makeClient(logsToken)
    expect(Array.isArray(await logs.logs.recent())).toBe(true)
  })

  it('preserves the complete MCP result envelope with a scoped credential', async () => {
    const client = makeClient(mcpToken)
    await client.mcp.connect()
    const result = await client.mcp.callTool('system.progress_test', { steps: 1 })
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.isError).toBe(false)
    await client.close()
  })

  it('uses the admin credential for registry filters, cache, and direct invoke', async () => {
    const client = makeClient(adminToken)
    const filtered = await client.registry.list({ name: toolName })
    expect(filtered.every((tool) => tool.metadata.name === toolName)).toBe(true)
    const stats = await client.cache.stats()
    expect(typeof stats.exactKeys).toBe('number')
    expect(typeof stats.redisMemory).toBe('string')
    const result = await client.invoke(toolName, {})
    expect(result.isError).toBeFalsy()
    expect(result.result).toBeDefined()
  })

  it('maps an absent credential to AuthenticationError and a wrong scope to AuthorizationError', async () => {
    const anonymous = makeAnonymousClient()
    await expect(anonymous.metrics.text()).rejects.toBeInstanceOf(AuthenticationError)

    const mcpOnly = makeClient(mcpToken)
    await expect(mcpOnly.metrics.text()).rejects.toBeInstanceOf(AuthorizationError)
  })
})

guardedIntegration('ERPBridge live integration (role authorization)', () => {
  it('passes an MCP role selector as an ordinary tool argument', async () => {
    const client = makeClient(adminToken)
    await client.mcp.connect()
    const result = await client.mcp.callTool(guardedToolName!, { ...guardedArguments, role: guardedRole })
    expect(result.isError).toBe(false)
    await client.close()
  })

  it('passes the direct-invoke role selector out of band', async () => {
    const client = makeClient(adminToken)
    const result = await client.invoke(guardedToolName!, guardedArguments!, { role: guardedRole })
    expect(result.isError).toBeFalsy()
    expect(result.result).toBeDefined()
  })
})
