# ERPBridge SDK

TypeScript client library for the ERPBridge server family. Embed ERPBridge in
your own products: call MCP tools by exact name, invoke tools over REST,
aggregate logs, read metrics, check health, and manage the cache and tool
registry.

- Node.js >= 20, dual ESM + CJS, dependency-light
- Typed errors across the whole surface
- No auth in v1 — v1 connects anonymously and surfaces server 401s as
  `AuthenticationError`. Auth is owned by the future auth plan (see
  [Plan-auth.md](.agents/plans/Plan-auth.md)).

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
console.log(result.result)
```

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

- `client.registry.list()` is REST CRUD over the stored tool resources and
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
