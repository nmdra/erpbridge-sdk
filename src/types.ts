/**
 * Shared types for the ERPBridge SDK.
 *
 * Everything exported here is part of the public API and is re-exported from
 * the package root, `@erpbridge/sdk/types`, and `@erpbridge/sdk/rest`.
 */

/** Configuration for an {@link ErpbridgeClient}. */
export interface ErpbridgeConfig {
  /**
   * Base URL of the ERPBridge server.
   *
   * @default "http://localhost:8080"
   */
  baseUrl: string
  /**
   * MCP streamable HTTP endpoint.
   *
   * @default `${baseUrl}/mcp/`
   */
  mcpUrl: string
  /**
   * Per-request timeout in milliseconds.
   *
   * @default 15_000
   */
  timeoutMs: number
  /**
   * Injectable `fetch` implementation (defaults to the global `fetch`).
   */
  fetch?: typeof fetch
  /**
   * Bearer token for the server. Declared but inert in v1: v1 connects
   * anonymously and surfaces server 401s as {@link AuthenticationError}.
   * Activation is owned by the future auth plan (D17).
   */
  token?: string
  /**
   * Name of an environment variable holding the bearer token. Inert in v1,
   * same as {@link ErpbridgeConfig.token}.
   */
  tokenEnv?: string
}

/**
 * A single structured log record from the server. Fields are lenient on
 * purpose (D11): the server's JSON field names are not formally pinned, so
 * unknown fields stay accessible through the open index signature.
 */
export type LogRecord = {
  level: string
  msg?: string
  time?: string
  component?: string
  session_id?: string
  request_id?: string
  tool_name?: string
} & Record<string, unknown>

/** A tool as registered on the server (MCP `tools/list` or the REST registry). */
export interface ToolDefinition {
  /** Exact registered tool name (bare, no prefix). */
  name: string
  /** Human-readable description of what the tool does. */
  description?: string
  /** JSON Schema (draft-07 subset) describing the tool's arguments. */
  inputSchema: Record<string, unknown>
}

/** The result of a tool invocation (MCP `tools/call` or REST invoke). */
export interface ToolResult {
  /** The tool's output payload. */
  result: unknown
  /** Error message, present when the tool itself failed. */
  error?: string
  /** True when the tool executed but reported a failure. */
  isError?: boolean
}

/** Arguments passed to a tool call. */
export type ToolCallArguments = Record<string, unknown>

/** Cache statistics reported by `GET /api/cache/stats`. */
export interface CacheStats {
  /** Number of exact-key cache entries (Redis DBSIZE). */
  exactKeys: number
  /** Human-readable Redis memory usage, e.g. `"1.2M"`. */
  redisMemory: string
}

/** Versioned identity of a registered tool (server `metadata`). */
export interface RegistryToolMetadata {
  /** Exact registered tool name (bare, no prefix). */
  name: string
  /** SemVer version of the tool. */
  version: string
  /** Module the tool belongs to. */
  module?: string
  /** Lifecycle status, e.g. `"ready"` or `"degraded"`. */
  status?: string
  /** Soft-delete visibility flag. */
  isActive?: boolean
}

/** A tool resource as stored in the REST registry (wire shape). */
export interface RegistryTool {
  /** Resource API version, e.g. `"erpbridge.io/v1"`. */
  apiVersion: string
  /** Resource kind, always `"Tool"`. */
  kind: string
  /** Versioned identity of the tool. */
  metadata: RegistryToolMetadata
  /** Behavior, interface, and execution details of the tool. */
  spec: RegistryToolSpec
}

/** Semantic description of a registered tool for LLM selection. */
export interface RegistryToolDescription {
  /** One-line summary of the tool. */
  short: string
  /** Situations where the tool fits. */
  whenToUse?: string[]
  /** Situations where the tool does not fit. */
  whenNotToUse?: string[]
  /** Example argument sets. */
  examples?: string[]
}

/** Argument property of a tool's input schema. */
export interface RegistryToolProperty {
  /** JSON Schema type, e.g. `"string"`. */
  type: string
  description?: string
  /** Allowed values for enum-like arguments. */
  enum?: string[]
  default?: unknown
}

/** Argument schema for a registered tool. */
export interface RegistryToolInputSchema {
  /** JSON Schema type of the arguments object, always `"object"`. */
  type: string
  /** Argument properties keyed by name. */
  properties: Record<string, RegistryToolProperty>
  /** Argument names the LLM must provide. */
  required?: string[]
}

/** HTTP execution binding of a registered tool. */
export interface RegistryToolExecution {
  /** Execution kind, `"http"`. */
  type: string
  /** HTTP method of the target ERP API. */
  method: string
  /** URL of the target ERP API. */
  endpoint: string
  /** Maps LLM argument names to ERP argument names. */
  mapping?: Record<string, string>
  /** JSONPath into the ERP response to unwrap as the result. */
  responsePath?: string
}

/** Auth requirements of a registered tool. */
export interface RegistryToolSecurity {
  /** `"api-key"`, `"basic"`, or `"bearer"`. */
  authType: string
  /** Environment variable name or vault key holding the credential. */
  credentialRef: string
}

/** LLM routing hints for a registered tool. */
export interface RegistryToolRouting {
  /** Selection priority. */
  priority: number
  /** Signals that make this tool a good fit. */
  signals: string[]
  /** Signals that make this tool a poor fit. */
  antiSignals: string[]
}

/** Support lifecycle of a tool version. */
export interface RegistryToolLifecycle {
  /** `"stable"`, `"deprecated"`, or `"sunset"`. */
  status: string
  /** ISO date the tool became deprecated. */
  deprecatedAt?: string
  /** ISO date the tool will be removed. */
  sunsetAt?: string
  /** Name of the tool version replacing this one. */
  replacement?: string
}

/** Behavior, interface, and execution details of a registered tool. */
export interface RegistryToolSpec {
  description?: RegistryToolDescription
  inputSchema?: RegistryToolInputSchema
  /** Optional output schema of the ERP response. */
  outputSchema?: unknown
  execution?: RegistryToolExecution
  /** Optional cache behavior of the tool. */
  cache?: unknown
  security?: RegistryToolSecurity
  routing?: RegistryToolRouting
  lifecycle?: RegistryToolLifecycle
}

/** Result of a successful `registry.apply()`. */
export interface ToolApplyResult {
  /** Always `"applied"`. */
  status: string
  /** Name of the applied tool. */
  name: string
  /** Version of the applied tool. */
  version: string
}

/** Options for `registry.delete()`. */
export interface RegistryDeleteOptions {
  /** Hard-delete from the store; otherwise soft delete. */
  hard?: boolean
}

/** A single metric sample with its label set. */
export interface MetricSample {
  /** Full series name, e.g. `erp_request_duration_seconds_bucket`. */
  name?: string
  /** Label names and values, e.g. `{ method: "GET" }`. */
  labels: Record<string, string>
  /** The sample's numeric value. */
  value: number
}

/**
 * A Prometheus metric family: a name, help text, type, and its samples.
 * Histograms surface their samples as the `_bucket`/`_sum`/`_count` series.
 */
export interface MetricFamily {
  /** Metric name, e.g. `erp_requests_total`. */
  name: string
  /** Metric family type: counter, gauge, or histogram. */
  type: 'counter' | 'gauge' | 'histogram'
  /** Help text from the `# HELP` line. */
  help: string
  /** Samples belonging to the family. */
  samples: MetricSample[]
}

/** Options accepted by {@link ErpbridgeError} constructors. */
export interface ErpbridgeErrorOptions extends ErrorOptions {
  /** The `WWW-Authenticate` challenge value, when the server sent one. */
  hint?: string
  /** Raw response body attached for diagnostics. */
  body?: unknown
  /** The `Retry-After` header value, when the server sent one. */
  retryAfter?: string
  /** HTTP status code that produced the error. */
  status?: number
}

/**
 * Base class of the SDK's typed error tree (D7). Never throw raw `Error`s
 * with string-matched messages — map every failure into this hierarchy.
 */
export class ErpbridgeError extends Error {
  constructor(message: string, options: ErpbridgeErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = new.target.name
    this.hint = options.hint
    this.body = options.body
    this.retryAfter = options.retryAfter
    this.status = options.status
  }

  /** The `WWW-Authenticate` challenge value, when the server sent one. */
  readonly hint?: string

  /** Raw response body attached for diagnostics. */
  readonly body?: unknown

  /** The `Retry-After` header value, when the server sent one. */
  readonly retryAfter?: string

  /** HTTP status code that produced the error, when applicable. */
  readonly status?: number
}

/**
 * The server rejected the request with HTTP 401. v1 connects anonymously,
 * so this surfaces the server's own 401s untouched (D3/D17).
 */
export class AuthenticationError extends ErpbridgeError {}

/**
 * The requested resource or tool does not exist (HTTP 404, or an MCP
 * "unknown tool" JSON-RPC error).
 */
export class NotFoundError extends ErpbridgeError {}

/** The server rate-limited the request (HTTP 429). */
export class RateLimitError extends ErpbridgeError {}

/** The request was rejected as malformed (HTTP 4xx other than 401/404/429). */
export class ClientError extends ErpbridgeError {}

/** The server failed to fulfil the request (HTTP 5xx). */
export class ServerError extends ErpbridgeError {}

/**
 * The MCP endpoint returned a JSON-RPC error (for example `-32601` unknown
 * method), or the transport failed in a way that cannot be retried.
 */
export class ProtocolError extends ErpbridgeError {
  constructor(message: string, options: { cause?: unknown; code: number }) {
    super(message, options)
    this.code = options.code
  }

  /** The JSON-RPC error code reported by the server. */
  readonly code: number
}