import { protocolError } from './errors.js'
import { request } from './http.js'
import type {
  ErpbridgeConfig,
  RegistryDeleteOptions,
  RegistryListOptions,
  RegistryTool,
  DirectInvokeOptions,
  ToolApplyResult,
  ToolCallArguments,
  ToolResult,
} from './types.js'

const REGISTRY_PATH = '/apis/erpbridge.io/v1/tools'
const INVOKE_PATH = '/api/tools/invoke'

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
  list(opts?: RegistryListOptions): Promise<RegistryTool[]>
  /**
   * Apply a tool definition (POST `/apis/erpbridge.io/v1/tools`).
   *
   * The server validates the definition through its admission controller
   * and rejects violations with HTTP 422, surfaced as a typed
   * {@link ClientError}.
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
  invoke(name: string, args: ToolCallArguments, opts?: DirectInvokeOptions): Promise<ToolResult>
}

/** Create the REST tool registry and invoke API. */
export function createRegistryApi(config: ErpbridgeConfig): RegistryApi {
  return {
    async list(opts: RegistryListOptions = {}): Promise<RegistryTool[]> {
      const query: Record<string, string | undefined> = {}
      if (opts.name !== undefined) query.name = opts.name
      if (opts.version !== undefined) query.version = opts.version
      const res = await request<unknown>(config, { path: REGISTRY_PATH, query })
      if (!Array.isArray(res.body)) {
        throw protocolError(`invalid response from ${REGISTRY_PATH}: expected an array`)
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
        throw protocolError(`invalid response from ${REGISTRY_PATH}: expected 201 { status, name, version }`)
      }
      return body as ToolApplyResult
    },

    async delete(name: string, version: string, opts: RegistryDeleteOptions = {}): Promise<void> {
      const query: Record<string, string | undefined> = { name, version }
      if (opts.hard === true) query.hard = 'true'
      await request<unknown>(config, { method: 'DELETE', path: REGISTRY_PATH, query })
    },

    async invoke(name: string, args: ToolCallArguments, opts: DirectInvokeOptions = {}): Promise<ToolResult> {
      const headers = opts.role === undefined ? undefined : { 'X-ERPBridge-Role': opts.role }
      const res = await request<unknown>(config, {
        method: 'POST',
        path: INVOKE_PATH,
        body: { name, arguments: args },
        headers,
      })
      const body = res.body as ToolResult | null
      if (body === null || typeof body !== 'object' || !('result' in body)) {
        throw protocolError(`invalid response from ${INVOKE_PATH}: expected { result }`)
      }
      return body
    },
  }
}
