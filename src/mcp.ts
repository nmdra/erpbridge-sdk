import {
  Client,
  InsufficientScopeError,
  ProtocolError as McpProtocolError,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import type { CallToolResult } from '@modelcontextprotocol/client'
import { credentialFor } from './config.js'
import { requiredScopeFromChallenge } from './auth.js'
import type { ErpbridgeConfig, McpToolResult, ToolCallArguments, ToolDefinition } from './types.js'
import { INTERNAL_ERROR_CODE } from './errors.js'
import { AuthenticationError, AuthorizationError, ErpbridgeError, NotFoundError, ProtocolError } from './types.js'
import { SDK_VERSION } from './version.js'

const CLIENT_NAME = '@erpbridge/sdk'
const CLIENT_VERSION = SDK_VERSION
export const INVALID_PARAMS_CODE = -32602

/**
 * MCP client wrapper around the official `@modelcontextprotocol/client`
 * (D2). Owns the connection lifecycle, maps protocol answers into the typed
 * error tree, and transparently reconnects once (new transport + full
 * re-initialize, fresh session) before giving up (R2).
 */
export class McpClient {
  private readonly config: ErpbridgeConfig
  private client: Client | undefined
  private transport: StreamableHTTPClientTransport | undefined
  private mcpChallenge: string | undefined

  constructor(config: ErpbridgeConfig) {
    this.config = config
  }

  /** Initialize a session: handshake, capability negotiation, session id. */
  async connect(): Promise<void> {
    assertMcpAccess(this.config)
    await this.close()
    const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION })
    this.mcpChallenge = undefined
    const transport = createTransport(this.config, (challenge) => {
      this.mcpChallenge = challenge
    })
    try {
      await client.connect(transport)
    } catch (error) {
      await transport.close().catch(() => {})
      await client.close().catch(() => {})
      const mapped = mapMcpError(error, undefined, this.mcpChallenge)
      if (mapped instanceof ErpbridgeError) throw mapped
      throw new ProtocolError(
        `failed to connect to ${this.config.mcpUrl}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, code: INTERNAL_ERROR_CODE },
      )
    }
    this.client = client
    this.transport = transport
  }

  /** List the tools the server currently exposes. */
  async listTools(): Promise<ToolDefinition[]> {
    return this.execute(async () => {
      try {
        const res = await this.requireClient().listTools()
        return res.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
        }))
      } catch (error) {
        throw mapMcpError(error, undefined, this.mcpChallenge)
      }
    })
  }

  /**
   * Call a tool by its exact registered name. Server-recognized execution
   * failures return the MCP `CallToolResult` envelope with `isError: true`;
   * an unknown tool surfaces as {@link NotFoundError}. Content blocks and
   * structured output are returned unchanged.
   */
  async callTool(name: string, args: ToolCallArguments): Promise<McpToolResult> {
    return this.execute(async () => {
      try {
        const res = await this.requireClient().callTool({ name, arguments: args })
        return res as CallToolResult
      } catch (error) {
        throw mapMcpError(error, name, this.mcpChallenge)
      }
    })
  }

  /** Close the current session and its transport. */
  async close(): Promise<void> {
    const transport = this.transport
    const client = this.client
    this.transport = undefined
    this.client = undefined
    if (transport) await transport.close().catch(() => {})
    if (client) await client.close().catch(() => {})
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new ProtocolError('MCP client is not connected; call connect() first', { code: INTERNAL_ERROR_CODE })
    }
    return this.client
  }

  /**
   * Execute an operation with the configured transport retry policy. The
   * default reconnects once for compatibility; `never` converts a transport
   * failure directly into a ProtocolError so a possibly-completed side effect
   * is never replayed by the SDK.
   */
  private async execute<T>(op: () => Promise<T>): Promise<T> {
    if ((this.config.mcpRetryPolicy ?? 'once') === 'never') {
      try {
        return await op()
      } catch (error) {
        if (isProtocolAnswer(error)) throw error
        throw toProtocolError(error)
      }
    }

    let retried = false
    for (;;) {
      try {
        return await op()
      } catch (error) {
        if (isProtocolAnswer(error)) throw error
        if (retried) throw toProtocolError(error)
        retried = true
        await this.reconnect()
      }
    }
  }

  private async reconnect(): Promise<void> {
    try {
      await this.connect()
    } catch (error) {
      if (error instanceof ErpbridgeError) throw error
      throw new ProtocolError(
        `reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, code: INTERNAL_ERROR_CODE },
      )
    }
  }
}

function mapMcpError(error: unknown, toolName?: string, challenge?: string): unknown {
  if (error instanceof UnauthorizedError || (error instanceof Error && error.name === 'UnauthorizedError')) {
    return new AuthenticationError(error instanceof Error ? error.message : 'MCP request was unauthorized', {
      status: 401,
      hint: challenge,
      wwwAuthenticate: challenge,
      cause: error instanceof Error ? error : undefined,
    })
  }
  if (error instanceof InsufficientScopeError || (error instanceof Error && error.name === 'InsufficientScopeError')) {
    const requiredScope = error instanceof InsufficientScopeError ? error.requiredScope : undefined
    return new AuthorizationError(error instanceof Error ? error.message : 'MCP request was forbidden', {
      status: 403,
      requiredScope,
      wwwAuthenticate: challenge,
      cause: error instanceof Error ? error : undefined,
    })
  }
  if (error instanceof SdkHttpError) {
    if (error.status === 401) {
      return new AuthenticationError(error.message, {
        status: 401,
        body: error.data,
        hint: challenge,
        wwwAuthenticate: challenge,
        cause: error,
      })
    }
    if (error.status === 403) {
      return new AuthorizationError(error.message, {
        status: 403,
        body: error.data,
        requiredScope: requiredScopeFromChallenge(challenge),
        wwwAuthenticate: challenge,
        cause: error,
      })
    }
  }
  if (error instanceof McpProtocolError || (error instanceof Error && typeof (error as { code?: unknown }).code === 'number')) {
    const code = (error as { code?: number }).code ?? INTERNAL_ERROR_CODE
    const message = error instanceof Error ? error.message : String(error)
    if (toolName !== undefined && isUnknownToolError(message, toolName, code)) {
      return new NotFoundError(message, { cause: error instanceof Error ? error : undefined })
    }
    return new ProtocolError(message, { cause: error instanceof Error ? error : undefined, code })
  }
  return error
}

function createTransport(config: ErpbridgeConfig, captureChallenge?: (challenge: string | undefined) => void): StreamableHTTPClientTransport {
  const credential = credentialFor(config, 'mcp')
  const fetchImpl = config.fetch ?? globalThis.fetch
  return new StreamableHTTPClientTransport(new URL(config.mcpUrl), {
    fetch: async (input, init) => {
      const response = await fetchImpl(input, init)
      captureChallenge?.(response.headers.get('www-authenticate') ?? undefined)
      return response
    },
    onInsufficientScope: 'throw',
    ...(credential.token ? { requestInit: { headers: { Authorization: `Bearer ${credential.token}` } } } : {}),
  })
}

function assertMcpAccess(config: ErpbridgeConfig): void {
  const credential = credentialFor(config, 'mcp')
  if (credential.declaredScopes && credential.declaredScopes.length > 0 && !credential.declaredScopes.includes('mcp')) {
    throw new AuthorizationError('configured credential does not declare required scope: mcp', { requiredScope: 'mcp' })
  }
}

function isUnknownToolError(message: string, toolName: string, code: number): boolean {
  return code === INVALID_PARAMS_CODE && message.includes(`tool '${toolName}' not found`)
}

function isProtocolAnswer(error: unknown): boolean {
  if (error instanceof ErpbridgeError || error instanceof McpProtocolError) return true
  if (error instanceof Error && error.name === 'AbortError') return true
  return false
}

function toProtocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) return error
  return new ProtocolError(
    error instanceof Error ? error.message : String(error),
    { cause: error instanceof Error ? error : undefined, code: INTERNAL_ERROR_CODE },
  )
}
