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

/** A single metric sample with its label set. */
export interface MetricSample {
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