import { ErpbridgeError, type AuthScope, type ErpbridgeConfig, type ResolvedAuth, type ResolvedCredential, type SurfaceAuth } from './types.js'

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
  /** Bearer token for the server, when supplied by the application. */
  token?: string
  /** Name of an environment variable holding the bearer token. */
  tokenEnv?: string
  /** Caller-declared scopes used only for optional local guards. */
  declaredScopes?: readonly AuthScope[]
  /** Per-surface credential overrides for MCP, metrics, and logs. */
  auth?: {
    mcp?: SurfaceAuth
    metrics?: SurfaceAuth
    logs?: SurfaceAuth
  }
}

const DEFAULT_BASE_URL = 'http://localhost:8080'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_TOKEN_ENV = 'ERPBRIDGE_TOKEN'
const LEGACY_DEFAULT_TOKEN_ENV = 'ERPBridge_TOKEN'
const resolvedAuthByConfig = new WeakMap<ErpbridgeConfig, ResolvedAuth>()

/**
 * Normalize a partial config into a fully-resolved {@link ErpbridgeConfig}.
 *
 * Fills defaults for `baseUrl`, `mcpUrl` (derived from `baseUrl`), `timeoutMs`,
 * and `fetch`. Auth fields are retained for the credential resolver.
 */
export function resolveConfig(input: ErpbridgeConfigInput = {}): ErpbridgeConfig {
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? DEFAULT_BASE_URL)
  const mcpUrl = input.mcpUrl ?? `${baseUrl}/mcp/`
  const config: ErpbridgeConfig = {
    baseUrl,
    mcpUrl,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetch: input.fetch ?? globalThis.fetch,
    token: input.token,
    tokenEnv: input.tokenEnv,
    declaredScopes: input.declaredScopes,
    auth: input.auth,
  }
  resolvedAuthByConfig.set(config, resolveAuth(input))
  return config
}

/** Resolve configured credentials once, without importing a Node-only module. */
export function resolveAuth(input: Pick<ErpbridgeConfigInput, 'token' | 'tokenEnv' | 'declaredScopes' | 'auth'>): ResolvedAuth {
  const globalSource = { token: input.token, tokenEnv: input.tokenEnv, declaredScopes: input.declaredScopes }
  const global = resolveCredential(globalSource, true)
  return {
    global,
    mcp: resolveSurfaceCredential(input.auth?.mcp, global),
    metrics: resolveSurfaceCredential(input.auth?.metrics, global),
    logs: resolveSurfaceCredential(input.auth?.logs, global),
  }
}

/** Return the credential for a request surface, resolving legacy direct configs as a fallback. */
export function credentialFor(config: ErpbridgeConfig, surface?: AuthScope): ResolvedCredential {
  const auth = resolvedAuthByConfig.get(config) ?? resolveAuth(config)
  return surface ? auth[surface] : auth.global
}

function resolveSurfaceCredential(surface: SurfaceAuth | undefined, global: ResolvedCredential): ResolvedCredential {
  if (!surface) return global
  const explicit = nonEmpty(surface.token)
  if (explicit) return { token: explicit, declaredScopes: surface.declaredScopes }
  const fromEnv = readEnvironment(surface.tokenEnv)
  if (fromEnv) return { token: fromEnv, declaredScopes: surface.declaredScopes }
  return global
}

function resolveCredential(source: SurfaceAuth, useDefaultEnvironment: boolean): ResolvedCredential {
  const explicit = nonEmpty(source.token)
  if (explicit) return { token: explicit, declaredScopes: source.declaredScopes }
  const usesDefaultEnvironment = source.tokenEnv === undefined && useDefaultEnvironment
  const environmentName = usesDefaultEnvironment ? DEFAULT_TOKEN_ENV : source.tokenEnv
  const fromEnv = readEnvironment(environmentName)
  if (fromEnv) return { token: fromEnv, declaredScopes: source.declaredScopes }
  if (usesDefaultEnvironment) {
    const legacy = readEnvironment(LEGACY_DEFAULT_TOKEN_ENV)
    if (legacy) return { token: legacy, declaredScopes: source.declaredScopes }
  }
  return {}
}

function readEnvironment(name: string | undefined): string | undefined {
  if (!name) return undefined
  const processLike = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process
  return nonEmpty(processLike?.env?.[name])
}

function nonEmpty(value: string | undefined): string | undefined {
  return value ? value : undefined
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
