# Plan: ERPBridge SDK Auth — FUTURE (separate from the v1 plan)

> [!CAUTION]
> **STRICT RULE: DO NOT IMPLEMENT THIS PLAN YET. IT IS A FUTURE PLAN.**
>
> The v1 execution plan is `.agents/plans/Plan.md` and is **auth-free by design** (decision D17). This plan activates only when the ERPBridge server's own auth ships. Do not run these tasks as part of v1 work.

## Status

- **Blocked on:** ERPBridge server auth — `ERPBridge/.agents/plans/Plan-Auth.md` tasks A1–A10 (all currently unchecked, verified 2026-08-20: no `API_AUTH_TOKEN` read, no `api_tokens` store, no `/apis/erpbridge.io/v1/tokens` route).
- **Canonical activation rule:** SDK auth work may start only after server A1–A10 are merged and available for live verification, the v1 SDK plan is released, and the user explicitly authorizes SDK auth work. User authorization permits this plan to start; it does not waive the server-completion or v1-release prerequisites.
- **Compatibility note:** the SDK config already declares inert `token?`/`tokenEnv?` fields (see Plan.md D17). Activating them is source-compatible but behavior-changing for consumers that already pass credentials: their values will begin to be sent as bearer tokens. Document that migration and select the semver treatment at activation time.

## Goal

Give `@erpbridge/sdk` token-based authentication for the ERPBridge server's protected surfaces:

- Resolve a bearer token once according to the documented global/per-surface precedence and inject it as `Authorization: Bearer` on every MCP and REST request that has a resolved credential.
- Map server 401s (with `WWW-Authenticate: Bearer` challenge) to the existing `AuthenticationError` with a clear hint; surface 403 scope errors distinctly.
- Be scope-aware (`mcp | metrics | logs`) so callers can pre-empt 403s on the wrong surface.
- Stay backwards-compatible: no token configured ⇒ connect unauthenticated (server open-mode), matching the server's `API_AUTH_TOKEN`-unset behavior.

## Design (aligned with the server plan)

| Server concept (Plan-Auth.md)                                                | SDK counterpart                                                                                                                                     |
| :--------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_AUTH_TOKEN` env admin credential                                        | SDK never handles admin credentials — operators configure tokens out of band (bridgectl `token create`).                                            |
| `erpbt_` API tokens, sha256-hashed in store, scopes `mcp\|metrics\|logs`     | SDK resolves a token and sends it; it does not create/revoke tokens (consume-only).                                                                 |
| Enforcement only when `API_AUTH_TOKEN` set (open-mode default)               | SDK sends the header only when a token is configured; no token ⇒ silent anonymous behavior.                                                         |
| `401` + `WWW-Authenticate: Bearer`                                           | `AuthenticationError` carries the challenge for programmatic inspection plus a safe configuration hint; tests and debug output never log its value. |
| Scope model: `mcp` → `/mcp/`, `metrics` → `/metrics`, `logs` → `/api/logs/*` | SDK per-surface config may carry distinct tokens, with optional caller-declared scopes for local guards only.                                       |

## Credential configuration and routing

`tokenEnv` means the **name of an environment variable**, not a token value. When omitted, its lookup name defaults to `ERPBridge_TOKEN`; an unset or empty value resolves as no token. The additive future config shape is `token?`, `tokenEnv?`, `declaredScopes?: readonly ('mcp' | 'metrics' | 'logs')[]`, and `auth?: { mcp?: SurfaceAuth; metrics?: SurfaceAuth; logs?: SurfaceAuth }`, where `SurfaceAuth` has the same three fields. This avoids colliding with the existing `mcpUrl` field.

For MCP, metrics, and logs respectively, resolution is: surface explicit `token` → surface `tokenEnv` value → global explicit `token` → global `tokenEnv` value → anonymous. `declaredScopes` follows the selected credential level. Health, cache, registry, and direct invoke use only the global credential or anonymous access until the server publishes an authorization policy for those endpoints. A declaration enables an optional local guard; it never proves server-granted scopes for an opaque token.

## Tasks (NOT to be run until activated)

- [ ] **F1 — Token resolution + injection** — extend `src/config.ts`/`src/http.ts` using the configuration and routing rules above; resolve credentials once and inject `Authorization: Bearer` on the HTTP core (T4 seam), MCP transport, reconnect-created transport, and logs SSE requests. Per-surface override is limited to `mcp`/`metrics`/`logs`; no token preserves silent anonymous access. Do not log request/response authorization values.
      (**Seam:** `src/config.ts` (resolveConfig), `src/http.ts` (request builder), `src/mcp.ts` (transport init); **Files:** src/config.ts, src/http.ts, src/mcp.ts + fixture tests; **Verify:** focused fixture tests assert header presence/absence and the full precedence matrix for REST, SSE, MCP initialize/follow-up/reconnect without printing header values; then `npm test && npm run build && npm run lint:publish`)
- [ ] **F2 — Auth error contract** — keep `wwwAuthenticate?: string` on `AuthenticationError` only; it supports programmatic inspection alongside a safe configuration hint; its value must not be logged in tests or debug output. Add and export `AuthorizationError extends ErpbridgeError` for HTTP 403, with status/body/message and optional `requiredScope` only when the server supplies it; never infer scopes from opaque tokens. Keep `RateLimitError` and `ProtocolError` unchanged. Document the server-provided scope requirements per surface.
      (**Seam:** `src/types.ts` error tree (D7); **Files:** src/types.ts, src/http.test.ts, src/mcp.test.ts; **Verify:** REST and MCP 401 → `AuthenticationError`; REST 403 → `AuthorizationError`; non-scope 403 preserves body/message without a guessed scope; then `npm test && npm run build && npm run lint:publish`)
- [ ] **F3 — Optional declared-scope guards** — per-surface helpers may fail fast only when the caller supplied `declaredScopes` and it excludes the required `mcp`, `metrics`, or `logs` scope. When scopes are absent, issue the request and rely on the server's 403 contract; local declarations never verify server-granted scopes.
      (**Seam:** `src/client.ts` (ErpbridgeClient surface); **Files:** src/client.ts + tests; **Verify:** declared `mcp` scope blocks `client.metrics.parsed()` before an HTTP call; absent declarations permit the HTTP call; then `npm test && npm run build && npm run lint:publish`)
- [ ] **F4 — Docs** — `docs/sdk/authentication.mdx` in erpbridge-docs (aligned with `docs/erpbridge/auth.mdx`): token acquisition via bridgectl, `ERPBridge_TOKEN` env, per-surface precedence/routing, caller-declared-scope limitation, and error handling. Update the README auth section and only the `CHANGELOG.md` Unreleased section; do not edit versioned entries. Coordinate the docs-repo change with the SDK behavior change/release cycle.
      (**Seam:** docs/sdk/ (already registered); **Files:** docs/sdk/authentication.mdx, README.md, CHANGELOG.md; **Verify:** `npm test && npm run build && npm run lint:publish` green in this repo; `npm run build` green in erpbridge-docs)

## Activation checklist (all must hold before starting)

1. Server `Plan-Auth.md` A1–A10 are merged and its protected MCP/REST surfaces are reachable for live verification.
2. The v1 plan (`Plan.md`) is complete and the SDK's v1 API is released; auth is assessed as a documented behavior change for consumers already supplying inert token fields.
3. The user explicitly authorizes SDK auth work after conditions 1–2 hold.
4. This file's `[ ]` boxes and credential-routing table are re-checked against the then-current server routes, scopes, 401 challenge format, 403 body, and any authorization policy for health/cache/registry/invoke.
5. The resulting tasks have concrete fixture/live tests, test-report handling under `Plan-testing.md`, and the required `npm test`, `npm run build`, and `npm run lint:publish` quality gates.

## Out of scope (still)

- Token create/list/revoke — that is server-admin (bridgectl), not SDK.
- OAuth / PKCE / dynamic client registration — the server explicitly rejected these (Plan-Auth.md A-D5).
- Stdio transport auth — the spec has none; the server keeps stdio local-only.
