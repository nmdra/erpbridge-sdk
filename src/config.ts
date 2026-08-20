import { ErpbridgeError, type ErpbridgeConfig } from './types.js'

/** Partial configuration accepted by the client factory before normalization. */
export interface ErpbridgeConfigInput {
  /** Base URL of the ERPBridge server. */
  baseUrl?: string
  /** MCP streamable HTTP endpoint. */
  mcpUrl?: string
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Injectable `fetch` implementation. */
  fetch?: typeof fetch
  /** Bearer token — inert in v1 (D17). */
  token?: string
  /** Name of an env var holding the bearer token — inert in v1 (D17). */
  tokenEnv?: string
}

const DEFAULT_BASE_URL = 'http://localhost:8080'
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Normalize a partial config into a fully-resolved {@link ErpbridgeConfig}.
 *
 * Fills defaults for `baseUrl`, `mcpUrl` (derived from `baseUrl`), `timeoutMs`,
 * and `fetch`. Auth fields are passed through untouched — v1 is auth-free by
 * design (D17); no token resolution or warning happens here.
 */
export function resolveConfig(input: ErpbridgeConfigInput = {}): ErpbridgeConfig {
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? DEFAULT_BASE_URL)
  const mcpUrl = input.mcpUrl ?? `${baseUrl}/mcp/`
  return {
    baseUrl,
    mcpUrl,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetch: input.fetch ?? globalThis.fetch,
    token: input.token,
    tokenEnv: input.tokenEnv,
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new ErpbridgeError(`invalid baseUrl: ${baseUrl}`)
  }
  return parsed.href.replace(/\/+$/, '')
}