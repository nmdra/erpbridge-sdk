import { resolveConfig } from './config.js'
import type { ErpbridgeConfigInput } from './config.js'
import { createLogsApi } from './logs.js'
import type { LogsApi } from './logs.js'
import { McpClient } from './mcp.js'
import { createMetricsApi } from './metrics.js'
import type { MetricsApi } from './metrics.js'
import { createRegistryApi } from './registry.js'
import type { RegistryApi } from './registry.js'
import { createSystemApi } from './system.js'
import type { SystemApi } from './system.js'
import { createToolsProxy } from './tools.js'
import type { ToolFunction } from './tools.js'
import type { DirectInvokeOptions, ToolCallArguments, ToolResult } from './types.js'

export type { McpToolResult } from './types.js'

/**
 * The public ERPBridge client facade.
 *
 * Nine surfaces: `.mcp` (protocol), `.tools` (exact-name MCP proxy),
 * `.registry` (REST registry CRUD, C3), `.invoke` (direct REST invocation),
 * `.logs`, `.metrics`, `.health`, `.cache`, and `.close()`.
 */
export interface ErpbridgeClient {
  /**
   * The MCP protocol surface: `connect()`, `listTools()`, `callTool()`,
   * `close()`. Registry REST reads and MCP protocol reads are distinct
   * surfaces returning different shapes (C3).
   */
  mcp: McpClient
  /**
   * Exact-name MCP tool proxy (lazy, discovery on first access).
   *
   * Lives outside `.registry` so registered names like `list`, `apply`, or
   * `delete` are never shadowed by the registry methods (C3).
   */
  tools: Record<string, ToolFunction>
  /** REST registry CRUD over the stored tool resources (C3). */
  registry: RegistryApi
  /** Direct REST tool invocation, identical to {@link RegistryApi.invoke}. */
  invoke: (name: string, args: ToolCallArguments, opts?: DirectInvokeOptions) => Promise<ToolResult>
  /** Log aggregation: {@link LogsApi.recent} and {@link LogsApi.stream}. */
  logs: LogsApi
  /** Metrics: raw Prometheus text and parsed families. */
  metrics: MetricsApi
  /** Server health check, from {@link SystemApi.health}. */
  health: SystemApi['health']
  /** Cache statistics and flushing, from {@link SystemApi.cache}. */
  cache: SystemApi['cache']
  /** Close the MCP session and its transport. */
  close: () => Promise<void>
}

/**
 * Create the ERPBridge client facade.
 *
 * @param input Partial configuration.
 *
 * @default `{ baseUrl: "http://localhost:8080" }` when omitted.
 */
export function createClient(input: ErpbridgeConfigInput = {}): ErpbridgeClient {
  const config = resolveConfig(input)
  const mcp = new McpClient(config)
  const registry = createRegistryApi(config)
  const system = createSystemApi(config)
  return {
    mcp,
    tools: createToolsProxy(mcp),
    registry,
    invoke: registry.invoke,
    logs: createLogsApi(config),
    metrics: createMetricsApi(config),
    health: system.health,
    cache: system.cache,
    close: () => mcp.close(),
  }
}
