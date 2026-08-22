# Live integration suite

This directory holds **Tier 3** tests (see `.agents/plans/Plan-testing.md`):
hermetic-free runs against a **real ERPBridge server**. They skip (never fail)
when `ERPBridge_TEST_SERVER` is unset.

## Prerequisites

- Docker with the Compose plugin, or a host Go + Python/uv path (below).
- `make generate-tools` needs Go + the ERPBridge repo's `bridgectl` binary.

## Run

Recommended: the ERPBridge repo's Docker Compose stack (server + mock ERP +
Redis), then seed tools, then run the suite:

```bash
# 1. Start the stack (builds the server image on first run)
cd ../ERPBridge
docker compose up -d --build

# 2. Wait for readiness
until curl -sf http://localhost:8080/mcp/health >/dev/null; do sleep 1; done

# 3. Seed tools from the Mock ERP OpenAPI (host-side, needs `make build`)
make build generate-tools

# 4. Run the suite
cd ../erpbridge-sdk
ERPBridge_TEST_SERVER=http://localhost:8080 npm run test:integration

# 5. Tear down (removes the data volume too)
cd ../ERPBridge
docker compose down -v
```

No Docker? Run the stack directly (Go server + `uv run main.py` mock ERP +
Redis via Docker Hub image): `make build`, start redis on 6379, `make run-mock`
(port 8081), then run `./erpbridge-server` with `BASE_URL`,
`ERP_BASE_URL=http://localhost:8081`, `REDIS_URL=redis://localhost:6379`,
`DATABASE_PATH`, and `ERP_PRIMARY_KEY` set; seed tools as above; then step 4.

Without the env var the suite runs and skips:

```bash
npm run test:integration   # all tests report "skipped"
```

## What is covered

`integration.test.ts` — happy paths: health, MCP connect/list/call, the
`tools.<name>` proxy on a seeded tool, REST invoke, logs (recent + stream with
clean abort), metrics (raw text + parsed counter/histogram families), cache
stats (Redis or memory mode), and a full registry apply/list/delete round-trip.

`integration-errors.test.ts` — error paths: unknown tool over MCP and REST
(NotFoundError), the tools proxy on an unknown name, and cache flush when the
cache is disabled.

`auth.test.ts` — opt-in v0.3.0-alpha.1 authentication coverage: scoped MCP,
metrics, and logs credentials; admin registry filters, cache stats, and direct
invoke; typed 401/403 mapping; the MCP result envelope; and optional guarded
tool calls. It is skipped unless all of these externally provisioned variables
are present: `ERPBridge_TEST_SERVER`, `ERPBridge_TEST_ADMIN_TOKEN`,
`ERPBridge_TEST_MCP_TOKEN`, `ERPBridge_TEST_METRICS_TOKEN`, and
`ERPBridge_TEST_LOGS_TOKEN`. Role tests additionally require
`ERPBridge_TEST_GUARDED_TOOL`, `ERPBridge_TEST_ROLE`, and optionally
`ERPBridge_TEST_GUARDED_ARGUMENTS_JSON` (defaults to `{}`).

Provision scoped tokens with the ERPBridge server's token tooling before the
run. The SDK test suite never creates, logs, stores, or reveals token values.
The admin token must have access to the seeded `ERPBridge_TEST_TOOL_NAME`
(default `list_employees`) and the server must have authentication enabled.

## Findings recorded at T13 time

- `system.sensitive_log_test` **does not** return HTTP 500 — it logs the
  provided token and returns a success message (verified in
  `ERPBridge/internal/mcp/server.go`). The T13 plan item "verify whether
  `system.sensitive_log_test` actually 500s" therefore resolved to *no*; no
  built-in tool 500s, so the "real 500" error case has no server-side trigger
  yet. Revisit when a tool that fails on execution is available (e.g. a
  `failWith`-style fixture tool).
- Built-in `system.*` tools are **not invokable over REST**: the direct-invoke
  handler resolves tools from the registry store only, so
  `invoke("system.progress_test")` 404s. REST invoke tests use the seeded
  `list_employees` tool instead.
- The live server **double-wraps tool text results**: `mcp.callTool` content is
  a text block whose text parses as `{"content":[{"type":"text","text":"..."}]}`
  (the handler chain JSON-marshals the tool result and wraps it in a new text
  block). The SDK maps the MCP envelope faithfully; MCP-call assertions inspect
  `JSON.stringify(result.content)` rather than a flattened `result` field.
- A successful cache stats response is valid in both Redis and memory mode;
  memory mode reports an empty `redisMemory`. The 503 assertion is retained
  only for a genuinely unavailable cache and is conditionally skipped when
  `cache.stats()` succeeds.
- The registry round-trip applies a probe tool (`sdk_integration_probe`) and
  hard-deletes it in a `finally` block, so the registry is left clean.
- `make generate-tools` fails on `schemas/erp/generated.yaml` (the CLI cannot
  parse the multi-document YAML it just generated — `sequence was used where
  mapping is expected`). Workaround: run `bridgectl tool apply -f
  schemas/erp/` after moving `generated.yaml` aside; the per-tool JSON files
  apply cleanly.

## Why not in CI yet

The stack needs Docker (server image build, mock ERP, Redis) and a host-side
Go build for seeding. The future path is a Docker Compose service in the CI
workflow or a dedicated `integration.yml` (see `.agents/plans/Plan.md` T13
notes and `.agents/plans/Plan-testing.md`).
