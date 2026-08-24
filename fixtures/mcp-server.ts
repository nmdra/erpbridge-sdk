import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Socket } from 'node:net'
import { closeTrackedServer, readBody, respond, respondJson, trackRequestSocket } from './helpers.js'

/** A tool the fixture exposes over MCP. */
export interface McpToolFixture {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  /** When set, calling this tool returns an execution failure (`isError: true`). */
  failWith?: string
  /** Complete MCP CallToolResult override for envelope-preservation tests. */
  result?: unknown
}

export interface McpFixtureOptions {
  tools?: McpToolFixture[]
  /** Number of requests allowed per session before the server expires it (404). */
  expireAfterRequests?: number
  /** Overrides the JSON-RPC error returned when an unknown tool is called. */
  unknownToolError?: { code: number; message: string }
  /** Return an HTTP auth failure for one MCP request method. */
  reject?: { method: string; status: 401 | 403; headers?: Record<string, string>; body?: unknown }
  /** Delay an initialize rejection until this many handshakes have completed. */
  rejectAfterHandshakes?: number
}

export interface McpFixture {
  url: string
  mcpUrl: string
  close(): Promise<void>
  /** Number of initialize handshakes the server has completed. */
  handshakeCount(): number
  /** The `clientInfo` from the most recent initialize request. */
  lastClientInfo(): { name?: unknown; version?: unknown } | undefined
  /** Authorization values observed on MCP requests, for injection assertions. */
  authorizationHeaders(): Array<string | undefined>
  /** Number of attempted `tools/call` requests, including expired-session attempts. */
  toolCallCount(): number
}

const DEFAULT_TOOLS: McpToolFixture[] = [
  {
    name: 'list_employees',
    description: 'List employees',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  { name: 'system.progress_test', description: 'Progress test tool', inputSchema: { type: 'object' } },
]

/**
 * A node:http fixture that speaks MCP streamable HTTP the way mcp-go does:
 * SSE-formatted POST responses, stateful sessions via `Mcp-Session-Id`, a
 * 404 for the OAuth metadata probe, and a long-lived GET SSE stream.
 */
export async function startMcpFixture(options: McpFixtureOptions = {}): Promise<McpFixture> {
  const tools = options.tools ?? DEFAULT_TOOLS
  let sessionCounter = 0
  let handshakes = 0
  let toolCalls = 0
  let clientInfo: { name?: unknown; version?: unknown } | undefined
  const sessionRequests = new Map<string, number>()
  const sockets = new Set<Socket>()
  const authorizationHeaders: Array<string | undefined> = []

  const server: Server = createServer(async (req, res) => {
    trackRequestSocket(req, res, sockets)
    authorizationHeaders.push(req.headers.authorization)

    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/.well-known/oauth-protected-resource') {
      respondJson(res, 404, { error: 'not found' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/mcp/') {
      if (options.reject?.method === 'GET') {
        respond(res, options.reject.status, { 'Content-Type': 'application/json', ...options.reject.headers }, JSON.stringify(options.reject.body ?? { error: 'authorization failed' }))
        return
      }
      // Long-lived SSE notification stream; stays open until the client leaves.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      return
    }

    if (req.method !== 'POST' || url.pathname !== '/mcp/') {
      respondJson(res, 405, { error: 'method not allowed' })
      return
    }

    const rawBody = await readBody(req)
    let msg: { id?: unknown; method?: string; params?: Record<string, unknown> }
    try {
      msg = JSON.parse(rawBody)
    } catch {
      respondJson(res, 400, { error: 'invalid JSON' })
      return
    }

    const sessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined
    const method = msg.method ?? ''
    if (method === 'tools/call') toolCalls++

    if (method !== 'initialize') {
      if (sessionId === undefined || !sessionRequests.has(sessionId)) {
        respondJson(res, 404, { error: 'session not found' })
        return
      }
      if (method === 'tools/list' || method === 'tools/call') {
        const count = sessionRequests.get(sessionId)! + 1
        if (options.expireAfterRequests !== undefined && count > options.expireAfterRequests) {
          sessionRequests.delete(sessionId)
          respondJson(res, 404, { error: 'session expired' })
          return
        }
        sessionRequests.set(sessionId, count)
      }
    }

    const rejection = options.reject
    const rejectionReady =
      rejection?.method === method &&
      (method !== 'initialize' || options.rejectAfterHandshakes === undefined || handshakes >= options.rejectAfterHandshakes)
    if (rejectionReady) {
      respond(res, rejection.status, { 'Content-Type': 'application/json', ...rejection.headers }, JSON.stringify(rejection.body ?? { error: 'authorization failed' }))
      return
    }

    if (method === 'initialize') {
      handshakes++
      clientInfo = msg.params?.clientInfo as { name?: unknown; version?: unknown } | undefined
      const sid = `sess-${++sessionCounter}`
      sessionRequests.set(sid, 0)
      respondSse(res, {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'erpbridge-fixture', version: '0.0.0' },
        },
      }, { 'Mcp-Session-Id': sid })
      return
    }

    if (method === 'notifications/initialized') {
      res.writeHead(202)
      res.end()
      return
    }

    if (method === 'tools/list') {
      respondSse(res, {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
          })),
        },
      })
      return
    }

    if (method === 'tools/call') {
      const params = msg.params ?? {}
      const name = typeof params.name === 'string' ? params.name : ''
      const tool = tools.find((t) => t.name === name)
      if (!tool) {
        respondSse(res, {
          jsonrpc: '2.0',
          id: msg.id,
          error: options.unknownToolError ?? { code: -32602, message: `tool '${name}' not found: tool not found` },
        })
        return
      }
      if (tool.failWith !== undefined) {
        respondSse(res, {
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: tool.failWith }], isError: true },
        })
        return
      }
      if (tool.result !== undefined) {
        respondSse(res, { jsonrpc: '2.0', id: msg.id, result: tool.result })
        return
      }
      const resultJSON = JSON.stringify({ ok: true, tool: tool.name, args: params.arguments ?? {} })
      respondSse(res, {
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: resultJSON }], isError: false },
      })
      return
    }

    respondSse(res, {
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32601, message: 'method not found' },
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    mcpUrl: `http://127.0.0.1:${port}/mcp/`,
    handshakeCount: () => handshakes,
    lastClientInfo: () => clientInfo,
    authorizationHeaders: () => [...authorizationHeaders],
    toolCallCount: () => toolCalls,
    close: () => closeTrackedServer(server, sockets),
  }
}

function respondSse(res: ServerResponse, payload: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...headers })
  res.end(`data: ${JSON.stringify(payload)}\n\n`)
}
