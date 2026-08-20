# ERPBridge SDK

TypeScript client library for the ERPBridge server family.

The SDK gives application and AI-agent developers a single, ergonomic way to consume an ERPBridge server — MCP tool calls, REST tool invocation, log aggregation, metrics, cache, and health — without hand-rolling JSON-RPC, SSE parsing, auth, or retry logic.

## Status

Work in progress — v0.1.0 planned. See [.agents/plans/Plan.md](.agents/plans/Plan.md) for the roadmap.

## Planned features

- **Built-in MCP client** for the ERPBridge server — connect, discover, and call tools programmatically (wraps `@modelcontextprotocol/client` v2)
- **Authentication** — bearer token resolution and injection (consume-only)
- **Log aggregation** — collect and inspect bridge logs from your application
- **Metrics** — read and parse Prometheus metrics from the server
- **Health, cache, and tool registry** — typed REST wrappers

## Development

```bash
npm install
npm test
npm run build
npm run lint:publish
```

See [AGENTS.md](AGENTS.md) for development rules and conventions.