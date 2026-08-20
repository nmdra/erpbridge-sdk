import type { IncomingMessage } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../fixtures/http-server.js'
import { createRegistryApi } from './registry.js'
import type { ErpbridgeConfig, RegistryTool, ToolApplyResult } from './types.js'
import { NotFoundError, ProtocolError, ServerError } from './types.js'

let fixture: FixtureServer

const config = (): ErpbridgeConfig => ({
  baseUrl: fixture.url,
  mcpUrl: `${fixture.url}/mcp/`,
  timeoutMs: 5000,
  fetch: globalThis.fetch,
})

const sampleTool: RegistryTool = {
  apiVersion: 'erpbridge.io/v1',
  kind: 'Tool',
  metadata: { name: 'list_employees', version: '1.0.0', module: 'hr', status: 'ready', isActive: true },
  spec: {
    description: {
      short: 'List employees in the HR module',
      whenToUse: ['when the user asks about employees'],
      whenNotToUse: ['when the user asks about payroll'],
    },
    inputSchema: {
      type: 'object',
      properties: { department: { type: 'string' } },
      required: ['department'],
    },
    execution: { type: 'http', method: 'GET', endpoint: 'https://erp.example/hr/employees' },
    security: { authType: 'api-key', credentialRef: 'ERP_API_KEY' },
  },
}

describe('registry', () => {
  let server: Awaited<ReturnType<typeof startFixtureServer>>

  beforeEach(async () => {
    fixture = await startFixtureServer([
      {
        method: 'GET',
        path: '/apis/erpbridge.io/v1/tools',
        body: [sampleTool],
      },
      {
        method: 'POST',
        path: '/apis/erpbridge.io/v1/tools',
        status: 201,
        body: (req: IncomingMessage, rawBody: string) => {
          const def = JSON.parse(rawBody) as { metadata?: { name?: string; version?: string } }
          return { status: 'applied', name: def.metadata?.name, version: def.metadata?.version }
        },
      },
      {
        method: 'DELETE',
        path: '/apis/erpbridge.io/v1/tools',
        status: 204,
      },
      {
        method: 'POST',
        path: '/api/tools/invoke',
        body: (req: IncomingMessage, rawBody: string) => {
          const call = JSON.parse(rawBody) as { name?: string; arguments?: unknown }
          return { result: { echo: call.name, args: call.arguments } }
        },
      },
    ])
  })

  afterEach(async () => {
    await fixture.close()
  })

  it('registry.list() returns the registered tools', async () => {
    const api = createRegistryApi(config())
    expect(await api.list()).toEqual([sampleTool])
  })

  it('registry.list() throws ProtocolError for a non-array body', async () => {
    const scoped = await startFixtureServer([{ method: 'GET', path: '/apis/erpbridge.io/v1/tools', body: { nope: true } }])
    try {
      const api = createRegistryApi({ ...config(), baseUrl: scoped.url })
      await expect(api.list()).rejects.toBeInstanceOf(ProtocolError)
    } finally {
      await scoped.close()
    }
  })

  it('registry.apply() sends the def and returns the applied result', async () => {
    const api = createRegistryApi(config())
    const expected: ToolApplyResult = { status: 'applied', name: 'list_employees', version: '1.0.0' }
    expect(await api.apply(sampleTool)).toEqual(expected)
  })

  it('registry.apply() maps the 422 admission error to ServerError', async () => {
    const scoped = await startFixtureServer([
      {
        method: 'POST',
        path: '/apis/erpbridge.io/v1/tools',
        status: 422,
        body: 'invalid tool: metadata.name is required\n',
      },
    ])
    try {
      const api = createRegistryApi({ ...config(), baseUrl: scoped.url })
      await expect(api.apply({ ...sampleTool, metadata: { ...sampleTool.metadata, name: '' } })).rejects.toBeInstanceOf(
        ServerError,
      )
      await expect(api.apply({ ...sampleTool, metadata: { ...sampleTool.metadata, name: '' } })).rejects.toMatchObject({
        name: 'ServerError',
        status: 422,
        message: 'invalid tool: metadata.name is required',
      })
    } finally {
      await scoped.close()
    }
  })

  it('registry.apply() throws ProtocolError for a malformed 201 body', async () => {
    const scoped = await startFixtureServer([{ method: 'POST', path: '/apis/erpbridge.io/v1/tools', body: { ok: true } }])
    try {
      const api = createRegistryApi({ ...config(), baseUrl: scoped.url })
      await expect(api.apply(sampleTool)).rejects.toBeInstanceOf(ProtocolError)
    } finally {
      await scoped.close()
    }
  })

  it('registry.delete() sends name and version and resolves on 204', async () => {
    const scoped = await startFixtureServer([
      {
        method: 'DELETE',
        path: '/apis/erpbridge.io/v1/tools',
        body: 'missing name or version parameter\n',
        status: (req: IncomingMessage) => {
          const query = new URL(req.url ?? '/', 'http://localhost').searchParams
          return query.get('name') === 'list_employees' && query.get('version') === '1.0.0' ? 204 : 400
        },
      },
    ])
    try {
      const api = createRegistryApi({ ...config(), baseUrl: scoped.url })
      await expect(api.delete('list_employees', '1.0.0')).resolves.toBeUndefined()
    } finally {
      await scoped.close()
    }
  })

  it('registry.delete({ hard: true }) sends hard=true', async () => {
    const scoped = await startFixtureServer([
      {
        method: 'DELETE',
        path: '/apis/erpbridge.io/v1/tools',
        body: 'missing hard parameter\n',
        status: (req: IncomingMessage) => {
          const query = new URL(req.url ?? '/', 'http://localhost').searchParams
          return query.get('hard') === 'true' ? 204 : 400
        },
      },
    ])
    try {
      const api = createRegistryApi({ ...config(), baseUrl: scoped.url })
      await expect(api.delete('list_employees', '1.0.0', { hard: true })).resolves.toBeUndefined()
    } finally {
      await scoped.close()
    }
  })

  it('invoke() sends { name, arguments } and returns the result', async () => {
    const api = createRegistryApi(config())
    expect(await api.invoke('list_employees', { department: 'engineering' })).toEqual({
      result: { echo: 'list_employees', args: { department: 'engineering' } },
    })
  })

  it('invoke() maps an unknown tool to NotFoundError', async () => {
    const scoped = await startFixtureServer([{ method: 'POST', path: '/api/tools/invoke', status: 404, body: 'tool not found' }])
    try {
      const api = createRegistryApi({ ...config(), baseUrl: scoped.url })
      await expect(api.invoke('nope', {})).rejects.toBeInstanceOf(NotFoundError)
      await expect(api.invoke('nope', {})).rejects.toMatchObject({ name: 'NotFoundError', status: 404 })
    } finally {
      await scoped.close()
    }
  })

  it('invoke() maps a failed tool execution to ServerError', async () => {
    const scoped = await startFixtureServer([
      { method: 'POST', path: '/api/tools/invoke', status: 500, body: { error: [{ type: 'text', text: 'erp call failed' }] } },
    ])
    try {
      const api = createRegistryApi({ ...config(), baseUrl: scoped.url })
      await expect(api.invoke('list_employees', {})).rejects.toBeInstanceOf(ServerError)
      await expect(api.invoke('list_employees', {})).rejects.toMatchObject({
        name: 'ServerError',
        status: 500,
        message: 'request failed with HTTP 500',
      })
    } finally {
      await scoped.close()
    }
  })
})