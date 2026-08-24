# Changelog

All notable changes to this project will be documented in this file. See [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) for the format.

## [1.1.0](https://github.com/nmdra/erpbridge-sdk/compare/sdk-v1.0.1...sdk-v1.1.0) (2026-08-24)


### Features

* **mcp:** add configurable transport retry policy ([9fbde7d](https://github.com/nmdra/erpbridge-sdk/commit/9fbde7d28f10d2dba4c3d70b0769153b00a7c7a1))

## [1.0.1](https://github.com/nmdra/erpbridge-sdk/compare/sdk-v1.0.0...sdk-v1.0.1) (2026-08-23)


### Bug Fixes

* **auth:** normalize default credential environment variable ([64519fb](https://github.com/nmdra/erpbridge-sdk/commit/64519fb9f4fe43ca844ad9928ac501b3a72ed7db))

## [1.0.0](https://github.com/nmdra/erpbridge-sdk/compare/sdk-v0.1.2...sdk-v1.0.0) (2026-08-22)


### ⚠ BREAKING CHANGES

* **sdk:** align client with ERPBridge v0.3

### Features

* **sdk:** align client with ERPBridge v0.3 ([1cdcebe](https://github.com/nmdra/erpbridge-sdk/commit/1cdcebee223da5a69f741f6827ccccb6ff1d208a))

## [0.1.2](https://github.com/nmdra/erpbridge-sdk/compare/sdk-v0.1.1...sdk-v0.1.2) (2026-08-21)


### Bug Fixes

* **mcp:** support browser-compatible MCP bundles ([9141f83](https://github.com/nmdra/erpbridge-sdk/commit/9141f83d6ff16af5971c310dace8fef11310d737))

## [0.1.1](https://github.com/nmdra/erpbridge-sdk/compare/sdk-v0.1.0...sdk-v0.1.1) (2026-08-21)


### Bug Fixes

* add ClientError for 4xx and route 4xx/5xx correctly ([2a77576](https://github.com/nmdra/erpbridge-sdk/commit/2a775761fe5330cc11666476cf2df50cda056d9b))
* avoid reconnect on abort and close client on connect failure ([90d07ae](https://github.com/nmdra/erpbridge-sdk/commit/90d07ae82bdb6f9ba015794e163a4ef0f85708ea))
* read MCP client version from package.json and use clearer internal names ([17979e5](https://github.com/nmdra/erpbridge-sdk/commit/17979e57bb563c074533e2e17e266fa57832ceb4))
* require the exact tool name before mapping unknown-tool to NotFoundError ([dd08f44](https://github.com/nmdra/erpbridge-sdk/commit/dd08f44c947c333e9f344421d3950881be433205))
* resolve the MCP client version defensively and test the handshake ([496389f](https://github.com/nmdra/erpbridge-sdk/commit/496389f3c600826db76fd1ece2404fc138da8d94))

## [Unreleased]

### Added

- `mcpRetryPolicy: 'once' | 'never'` controls MCP transport replay. The default preserves one reconnect; `never` prevents duplicate tool calls after an ambiguous transport failure.
- `ClientError` — typed HTTP 4xx (other than 401/404/429): the new `ErpbridgeError` subclass for bad requests and admission failures.
- Public `AuthScope` and `SurfaceAuth` configuration types, plus
  `AuthorizationError` for the ERPBridge 403 contract. Credential injection
  and surface routing are delivered in the following compatibility tasks.
- REST 403 responses now map to `AuthorizationError`; caller-declared surface
  scopes can fail fast before a request is sent.
- MCP Streamable HTTP requests, including reconnects, now carry the resolved
  MCP bearer credential; MCP 401/403 transport failures map to typed auth
  errors without retrying authorization failures.
- MCP calls now return the official `McpToolResult` envelope unchanged;
  REST direct invocation continues to return `ToolResult`.
- Registry listing accepts exact `name`/`version` filters, manifests use
  `kind: "MCPTool"` with optional `allowedRoles`, and direct invoke supports
  the `X-ERPBridge-Role` selector.

### Changed

- `request()` now maps non-401/404/429 HTTP 4xx (including 400 and the registry 422 admission error) to `ClientError`; 5xx remain `ServerError`, so `registry.apply()` admission failures now surface as `ClientError` instead of `ServerError`.

### Fixed

- Use `ERPBRIDGE_TOKEN` as the canonical default credential environment
  variable, with `ERPBridge_TOKEN` retained as a legacy fallback.
- Removed the runtime `node:module` dependency from the MCP client version
  lookup so browser ESM bundlers can use the MCP/tools surface without a Node
  built-in polyfill. Node ESM and CJS consumers remain supported.
- MCP unknown-tool errors now require the exact tool name (`tool '<name>' not found`) before mapping to `NotFoundError`; a message mentioning a different tool no longer mis-classifies.
- MCP client-info version is injected from `package.json` at build time, so the advertised version stays in sync with releases without a runtime manifest lookup (previously hard-coded in two places).

### Removed

- Dropped the TypeDoc API-reference site and its Pages deploy workflow (typedoc cannot run on TypeScript 7); the hand-written SDK docs in the erpbridge-docs site remain the single source of truth.

## [0.1.0](https://github.com/nmdra/erpbridge-sdk/compare/sdk-v0.0.1...sdk-v0.1.0) (2026-08-20)


### Features

* add health and cache management surface ([4a4ce4f](https://github.com/nmdra/erpbridge-sdk/commit/4a4ce4f40aa033d79fc3b5ba73754bba345130a6))
* add HTTP core with typed error mapping ([a4421b6](https://github.com/nmdra/erpbridge-sdk/commit/a4421b6f10404422f1c655fb851343ab300a2699))
* add logs REST surface with SSE streaming ([a337021](https://github.com/nmdra/erpbridge-sdk/commit/a33702179bd4a43e319d3625f85734a0ae945754))
* add MCP client wrapper with session reconnect ([7d4f5aa](https://github.com/nmdra/erpbridge-sdk/commit/7d4f5aa33b2c7d2062da99c66a8e60aa02e28a96))
* add metrics REST surface with Prometheus text parser ([3a0f5c9](https://github.com/nmdra/erpbridge-sdk/commit/3a0f5c90249a497eb9d881a54a3ccb7fc847d1ed))
* add tool registry CRUD and direct invoke ([81ce822](https://github.com/nmdra/erpbridge-sdk/commit/81ce8227a90873cfcbd6369a8cf416f4342cdb5a))
* add typed error tree and shared data types ([c3c79a9](https://github.com/nmdra/erpbridge-sdk/commit/c3c79a93f6e9afcd0f2cd7e9230f5f3b74c08a65))
* add typed tool proxy with schema validation ([c994a3f](https://github.com/nmdra/erpbridge-sdk/commit/c994a3fe4a842e6878dc4b5c360317e820a5e2f3))
* assemble the public client facade and subpath entries ([6868af8](https://github.com/nmdra/erpbridge-sdk/commit/6868af8ef84ad3d4816b1eff9b76791135697f0c))
* normalize client config with defaults ([80600a9](https://github.com/nmdra/erpbridge-sdk/commit/80600a9cc505f9709652c0f64c092ace2e5729f6))
