# ERPBridge SDK

TypeScript client library for the ERPBridge server family. Embed ERPBridge in
your own products: call MCP tools by exact name, invoke tools over REST,
aggregate logs, read metrics, check health, and manage the cache and tool
registry.

- Node.js >= 20, dual ESM + CJS, dependency-light
- Browser ESM support for the MCP client and exact-name tool proxy
- Typed errors across the whole surface
- Consume-only bearer authentication aligned with ERPBridge v0.3.0-alpha.1;
  the SDK never creates or revokes tokens.

## Authentication

The SDK supports consume-only bearer authentication for ERPBridge
v0.3.0-alpha.1 and later. Provide an application-managed token directly or by
environment-variable name; the SDK never creates, revokes, refreshes, or stores
tokens.

```ts
const client = createClient({
  tokenEnv: 'ERPBridge_TOKEN',
  auth: { metrics: { tokenEnv: 'ERPBridge_METRICS_TOKEN' } },
})
```

Per-surface credentials take precedence over the global credential for MCP,
metrics, and logs. Open-mode servers continue to work anonymously. See the
[SDK authentication guide](https://github.com/nmdra/erpbridge-docs/blob/main/docs/sdk/authentication.mdx)
for scope declarations and typed 401/403 errors.

## Install

```bash
npm install @erpbridge/sdk
```

## Quickstart

```ts
import { createClient } from '@erpbridge/sdk'

const client = createClient({ baseUrl: 'http://localhost:8080' })

await client.mcp.connect()
const result = await client.tools.list_employees({ department: 'engineering' })
console.log(result.content)
```

Browser applications can use the ESM build for `client.mcp` and
`client.tools` when the ERPBridge `/mcp/` endpoint is configured for the
frontend origin. The browser requires the server's MCP CORS policy to allow
the protocol and session headers. The REST surfaces are not covered by the
browser support contract in this release; use Node.js, a same-origin server,
or an application proxy for those APIs.

`client.tools` is a lazy proxy over the MCP `tools/list` result: every property
is a registered tool called by its exact name. Call `client.mcp.close()` when
done, or `client.close()` to tear down the session.

## REST surface

| Surface      | Description                                             |
| ------------ | ------------------------------------------------------- |
| `client.logs` | `recent()` JSON records, `stream()` SSE log streaming   |
| `client.metrics` | Raw Prometheus text and parsed families            |
| `client.health` | Server health check                                  |
| `client.cache` | Cache stats and flush                                |
| `client.registry` | Tool registry CRUD (list/apply/delete)             |
| `client.invoke` | Direct REST tool invocation                         |

## Registry vs. MCP tool listing

Two surfaces return different shapes — do not confuse them:

- `client.registry.list({ name, version })` is REST CRUD over the stored tool resources and
  returns the full wire shape (`RegistryTool`: `apiVersion`/`kind`/`metadata`/
  `spec`).
- `client.mcp.listTools()` is the MCP protocol `tools/list` and returns flat
  `ToolDefinition`s (`name`/`description`/`inputSchema`).

The registry deliberately lives outside `client.tools` so registered tool names
such as `list`, `apply`, or `delete` never shadow the registry methods.

## Error handling

Every failure is a typed error from a single hierarchy:

```
ErpbridgeError
├── AuthenticationError  (server rejected the request as unauthenticated)
├── AuthorizationError   (server rejected the request as unauthorized)
├── NotFoundError        (unknown tool or resource)
├── RateLimitError       (HTTP 429, with retryAfter)
├── ClientError          (HTTP 4xx with status and body)
├── ServerError          (HTTP 5xx with status and body)
└── ProtocolError        (protocol or session failure, with numeric code)
```

```ts
import { ErpbridgeError, NotFoundError } from '@erpbridge/sdk'

try {
  await client.tools.list_employees({})
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error(`tool missing: ${error.message}`)
  } else if (error instanceof ErpbridgeError) {
    console.error(`erpbridge: ${error.message}`)
  }
}
```

Never match error behavior on raw `Error` message strings.

## Development

```bash
npm install
npm test
npm run build
npm run lint:publish
```

See [.agents/plans/Plan.md](.agents/plans/Plan.md) for the roadmap and
[AGENTS.md](AGENTS.md) for development rules.
