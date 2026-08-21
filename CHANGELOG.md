# Changelog

All notable changes to this project will be documented in this file. See [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) for the format.

## [Unreleased]

### Added

- `ClientError` — typed HTTP 4xx (other than 401/404/429): the new `ErpbridgeError` subclass for bad requests and admission failures.

### Changed

- `request()` now maps non-401/404/429 HTTP 4xx (including 400 and the registry 422 admission error) to `ClientError`; 5xx remain `ServerError`, so `registry.apply()` admission failures now surface as `ClientError` instead of `ServerError`.

### Fixed

- MCP unknown-tool errors now require the exact tool name (`tool '<name>' not found`) before mapping to `NotFoundError`; a message mentioning a different tool no longer mis-classifies.

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