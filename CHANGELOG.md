# Changelog

All notable changes to this project will be documented in this file. See [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) for the format.

## Unreleased

### Added

- Initial project scaffold: dual ESM/CJS build (tsdown), strict TypeScript config, vitest, and package metadata for `@erpbridge/sdk`.
- MCP client wrapper (`McpClient`) with session lifecycle, version negotiation, one transparent reconnect, and typed protocol errors.
- Exact-name tool proxy (`client.tools`) with lazy discovery and per-property argument validation against the tool input schema.
- Log aggregation: `client.logs.recent()` and `client.logs.stream()` (typed SSE).
- Metrics: `client.metrics.text()` raw Prometheus text and `client.metrics.parsed()` families.
- Health and cache: `client.health()` and `client.cache.stats()` / `client.cache.flush()`.
- Tool registry and direct invoke: `client.registry.list()` / `apply()` / `delete()` and `client.invoke()`.
- Public facade `createClient()` with nine member surfaces and `@erpbridge/sdk` subpath entries (`./client`, `./rest`, `./types`).