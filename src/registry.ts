import { request } from './http.js'
import type {
  ErpbridgeConfig,
  RegistryDeleteOptions,
  RegistryTool,
  ToolApplyResult,
  ToolCallArguments,
  ToolResult,
} from './types.js'
import { ProtocolError } from './types.js'

const REGISTRY_PATH = '/apis/erpbridge.io/v1/tools'
const INVOKE_PATH = '/api/tools/invoke'
const INTERNAL_ERROR_CODE = -32000

/**
 * The tool registry and direct invoke surface (D4).
 *
 * Distinct from `client.tools` (the MCP exact-name proxy) and
 * `client.mcp.listTools()` (the MCP protocol): the registry is REST CRUD
 * over the stored tool resources and returns the full wire shape
 * ({@link RegistryTool}), not the flat {@link ToolDefinition}.
 */
export interface RegistryApi {
  /** List all registered tools (GET `/apis/erpbridge.io/v1/tools`). */
  list(): Promise<RegistryTool[]>
  /**
   * Apply a tool definition (POST `/apis/erpbridge.io/v1/tools`).
   *
   * The server validates the definition through its admission controller
   * and rejects violations with HTTP 422, surfaced as a typed
   * {@link ServerError}.
   */
  apply(def: RegistryTool): Promise<ToolApplyResult>
  /**
   * Soft-delete (or hard-delete with `{ hard: true }`) a tool version
   * (DELETE `/apis/erpbridge.io/v1/tools`).
   */
  delete(name: string, version: string, opts?: RegistryDeleteOptions): Promise<void>
  /**
   * Invoke a registered tool directly over REST
   * (POST `/api/tools/invoke`).
   *
   * Unknown tools surface as {@link NotFoundError}; a failed tool execution
   * surfaces as {@link ServerError}.
   */
  invoke(name: string, args: ToolCallArguments): Promise<ToolResult>
}

/** Create the REST tool registry and invoke API. */
export function createRegistryApi(config: ErpbridgeConfig): RegistryApi {
  return {
    async list(): Promise<RegistryTool[]> {
      const res = await request<unknown>(config, { path: REGISTRY_PATH })
      if (!Array.isArray(res.body)) {
        throw new ProtocolError(`invalid response from ${REGISTRY_PATH}: expected an array`, {
          code: INTERNAL_ERROR_CODE,
        })
      }
      return res.body as RegistryTool[]
    },

    async apply(def: RegistryTool): Promise<ToolApplyResult> {
      const res = await request<unknown>(config, { method: 'POST', path: REGISTRY_PATH, body: def })
      const body = res.body as Partial<ToolApplyResult> | null
      if (
        res.status !== 201 ||
        body === null ||
        typeof body !== 'object' ||
        body.status !== 'applied' ||
        typeof body.name !== 'string' ||
        typeof body.version !== 'string'
      ) {
        throw new ProtocolError(`invalid response from ${REGISTRY_PATH}: expected 201 { status, name, version }`, {
          code: INTERNAL_ERROR_CODE,
        })
      }
      return body as ToolApplyResult
    },

    async delete(name: string, version: string, opts: RegistryDeleteOptions = {}): Promise<void> {
      const query: Record<string, string | undefined> = { name, version }
      if (opts.hard === true) query.hard = 'true'
      await request<unknown>(config, { method: 'DELETE', path: REGISTRY_PATH, query })
    },

    async invoke(name: string, args: ToolCallArguments): Promise<ToolResult> {
      const res = await request<unknown>(config, { method: 'POST', path: INVOKE_PATH, body: { name, arguments: args } })
      const body = res.body as ToolResult | null
      if (body === null || typeof body !== 'object' || !('result' in body)) {
        throw new ProtocolError(`invalid response from ${INVOKE_PATH}: expected { result }`, {
          code: INTERNAL_ERROR_CODE,
        })
      }
      return body
    },
  }
}