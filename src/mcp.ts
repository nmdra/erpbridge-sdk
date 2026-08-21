import { Client, ProtocolError as McpProtocolError, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { ContentBlock } from '@modelcontextprotocol/client'
import type { ErpbridgeConfig, ToolCallArguments, ToolDefinition, ToolResult } from './types.js'
import { createRequire } from 'node:module'
import { INTERNAL_ERROR_CODE } from './errors.js'
import { ErpbridgeError, NotFoundError, ProtocolError } from './types.js'

const CLIENT_NAME = '@erpbridge/sdk'
const CLIENT_VERSION: string = createRequire(import.meta.url)('../package.json').version as string
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

  constructor(config: ErpbridgeConfig) {
    this.config = config
  }

  /** Initialize a session: handshake, capability negotiation, session id. */
  async connect(): Promise<void> {
    await this.close()
    const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION })
    const transport = new StreamableHTTPClientTransport(new URL(this.config.mcpUrl), {
      fetch: this.config.fetch ?? globalThis.fetch,
    })
    try {
      await client.connect(transport)
    } catch (error) {
      await transport.close().catch(() => {})
      await client.close().catch(() => {})
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
        throw mapMcpError(error)
      }
    })
  }

  /**
   * Call a tool by its exact registered name. Server-recognized execution
   * failures return `ToolResult { isError: true }`; an unknown tool surfaces
   * as {@link NotFoundError}. A single text content item is returned parsed
   * as JSON when it parses, otherwise as the raw string.
   */
  async callTool(name: string, args: ToolCallArguments): Promise<ToolResult> {
    return this.execute(async () => {
      try {
        const res = await this.requireClient().callTool({ name, arguments: args })
        return { result: mapContent(res.content), isError: res.isError ?? false }
      } catch (error) {
        throw mapMcpError(error, name)
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
   * Execute an operation with at most one transparent reconnect: on a
   * transport-level failure, create a new transport and re-initialize, then
   * retry once. Protocol answers (typed errors) are never retried. A second
   * transport failure throws {@link ProtocolError} (R2).
   */
  private async execute<T>(op: () => Promise<T>): Promise<T> {
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
      throw new ProtocolError(
        `reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, code: INTERNAL_ERROR_CODE },
      )
    }
  }
}

function mapMcpError(error: unknown, toolName?: string): unknown {
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

function mapContent(content: ContentBlock[] | undefined): unknown {
  if (!content || content.length === 0) return null
  if (content.length === 1) {
    const only = content[0]!
    if (only.type === 'text') return parseJsonOrText(only.text)
    return only
  }
  return content.map((c) => {
    if (c.type === 'text') return parseJsonOrText(c.text)
    return c
  })
}

function parseJsonOrText(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return text
    }
  }
  return text
}