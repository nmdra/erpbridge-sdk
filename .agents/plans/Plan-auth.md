# Plan: ERPBridge SDK Auth — FUTURE (separate from the v1 plan)

> [!CAUTION]
> **STRICT RULE: DO NOT IMPLEMENT THIS PLAN YET. IT IS A FUTURE PLAN.**
>
> The v1 execution plan is `.agents/plans/Plan.md` and is **auth-free by design** (decision D17). This plan activates only when the ERPBridge server's own auth ships. Do not run these tasks as part of v1 work.

## Status

- **Blocked on:** ERPBridge server auth — `ERPBridge/.agents/plans/Plan-Auth.md` tasks A1–A10 (all currently unchecked, verified 2026-08-20: no `API_AUTH_TOKEN` read, no `api_tokens` store, no `/apis/erpbridge.io/v1/tokens` route).
- **Activation trigger:** the server plan's A4 (MCP bearer gate) and A5 (metrics/logs gate) merged, or the user's explicit sign-off to start SDK auth work.
- **Prerequisite that already exists:** the SDK config already declares inert `token?`/`tokenEnv?` fields (default `ERPBridge_TOKEN`) so this plan slots in without an API break (see Plan.md D17).

## Goal

Give `@erpbridge/sdk` token-based authentication for the ERPBridge server's protected surfaces:

- Resolve a bearer token once (explicit config > `ERPBridge_TOKEN` env) and inject it as `Authorization: Bearer` on every MCP and REST request.
- Map server 401s (with `WWW-Authenticate: Bearer` challenge) to the existing `AuthenticationError` with a clear hint; surface 403 scope errors distinctly.
- Be scope-aware (`mcp | metrics | logs`) so callers can pre-empt 403s on the wrong surface.
- Stay backwards-compatible: no token configured ⇒ connect unauthenticated (server open-mode), matching the server's `API_AUTH_TOKEN`-unset behavior.

## Design (aligned with the server plan)

| Server concept (Plan-Auth.md) | SDK counterpart |
| :--- | :--- |
| `API_AUTH_TOKEN` env admin credential | SDK never handles admin credentials — operators configure tokens out of band (bridgectl `token create`). |
| `erpbt_` API tokens, sha256-hashed in store, scopes `mcp\|metrics\|logs` | SDK resolves a token and sends it; it does not create/revoke tokens (consume-only). |
| Enforcement only when `API_AUTH_TOKEN` set (open-mode default) | SDK sends the header only when a token is configured; no token ⇒ anonymous + (optional) one-time warning. |
| `401` + `WWW-Authenticate: Bearer` | `AuthenticationError` carries the challenge + a hint ("set `ERPBridge_TOKEN` or pass `token` to `createClient`"). |
| Scope model: `mcp` → `/mcp/`, `metrics` → `/metrics`, `logs` → `/api/logs/*` | SDK per-surface config: `mcp`, `metrics`, `logs` sections can carry distinct tokens (or one token with all scopes). |

## Tasks (NOT to be run until activated)

- [ ] **F1 — Token resolution + injection** — extend `src/config.ts`/`src/http.ts`: resolve token (explicit `token` > `tokenEnv` > `process.env.ERPBridge_TOKEN`), inject `Authorization: Bearer` on the HTTP core (T4 seam) and the MCP transport. Per-surface token override for `mcp`/`metrics`/`logs`. Warn once when a surface is configured without a token.
      (**Seam:** `src/config.ts` (resolveConfig), `src/http.ts` (request builder), `src/mcp.ts` (transport init); **Files:** src/config.ts, src/http.ts, src/mcp.ts + tests; **Verify:** fixture asserts header present/absent per config; precedence matrix green; no token ⇒ no header + single warning)
- [ ] **F2 — Auth error polish** — enrich `AuthenticationError`/`RateLimitError`/`ProtocolError` with the server's challenge header and a "scope mismatch" subclass for 403s; document scope requirements per surface.
      (**Seam:** `src/types.ts` error tree (D7); **Files:** src/types.ts, src/http.test.ts; **Verify:** 401 → `AuthenticationError` with `wwwAuthenticate`; 403 on `/metrics` with an `mcp`-scoped token → scoped error)
- [ ] **F3 — Per-surface client helpers** — convenience accessors that pre-check the configured token's declared scopes before issuing a call (fail fast with a clear error instead of waiting for the server 403).
      (**Seam:** `src/client.ts` (ErpbridgeClient surface); **Files:** src/client.ts + tests; **Verify:** `client.metrics.parsed()` without a metrics-scoped token throws before the HTTP call)
- [ ] **F4 — Docs** — `docs/sdk/authentication.mdx` in erpbridge-docs (aligned with `docs/erpbridge/auth.mdx`): token acquisition via bridgectl, `ERPBridge_TOKEN` env, per-surface scopes, error handling. Update README auth section + CHANGELOG.
      (**Seam:** docs/sdk/ (already registered); **Files:** docs/sdk/authentication.mdx, README.md, CHANGELOG.md; **Verify:** `npm run build` green in erpbridge-docs)

## Activation checklist (all must hold before starting)

1. Server `Plan-Auth.md` A1–A6 merged (store, handlers, middleware, MCP/metrics/logs gates, scope matrix) — or user sign-off.
2. This file's `[ ]` boxes re-checked against the then-current server surface (routes, scopes, challenge format).
3. The v1 plan (`Plan.md`) is complete and the SDK's v1 API is released (no breaking changes to back-port).

## Out of scope (still)

- Token create/list/revoke — that is server-admin (bridgectl), not SDK.
- OAuth / PKCE / dynamic client registration — the server explicitly rejected these (Plan-Auth.md A-D5).
- Stdio transport auth — the spec has none; the server keeps stdio local-only.