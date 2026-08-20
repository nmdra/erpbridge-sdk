# AI Agent Guide

TypeScript client library for the ERPBridge server family: `@erpbridge/sdk`. Wraps `@modelcontextprotocol/client` (v2) plus typed REST wrappers (logs, metrics, health, cache, tool registry, invoke). Consumed by application and AI-agent developers embedding ERPBridge in their own products.

## Development Rules

Rules for agents making changes to this repository.

### Plan first

- Read the active plan before coding: `.agents/plans/Plan.md`. Implement tasks in order and tick each checkbox as it completes.
- Each plan task carries a `Verify:` command — the task is done only when that command is green.
- Open a plan (or extend it) for any work the plan doesn't cover.

### Small commits

- One plan task = one commit. Keep commits small and single-purpose; separate unrelated changes into their own commits.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `build:`, `refactor:`, `test:`) — the git-commiter skill handles message generation and staging.
- Never commit generated artifacts (`dist/`, `node_modules/`, `*.tgz`).

### TDD

- Follow the tdd skill workflow: write the failing test first (red), watch it fail, implement the minimum (green), then refactor.
- Tests live beside the code they cover (`src/*.test.ts`) with `vitest`. Use the `node:http` fixture servers (under `fixtures/`) for hermetic HTTP/MCP tests — do not mock `fetch` or the MCP SDK.
- Add a test for every behavior change; a change without a test is not complete.
- Live integration tests go under `tests/integration/`, gated behind the `ERPBridge_TEST_SERVER` env var (skipped when unset).

### Quality gates

- Run `npm test` and `npm run build` before finishing any task; run `npm run lint:publish` (publint + attw --pack on the tarball) for anything that ships in the package.
- Behavior changes update README.md and CHANGELOG.md (Unreleased) in the same commit.
- Product-facing documentation lives in the **erpbridge-docs** repo under `docs/sdk/` (single source of truth) — update it in the same commit as the behavior, and run `npm run build` there to verify links.

### Release pipeline

- Versions and changelogs come from **release-please** (Conventional Commits drive bumps: `fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` footer → major). Never hand-edit `CHANGELOG.md` version entries or bump the version field yourself — the release PR does it. Write Unreleased entries only.
- Publishing uses **npm Trusted Publishing (OIDC)** from CI — no `NODE_AUTH_TOKEN`, provenance is automatic. `package.json` `repository.url` must exactly match the GitHub repo or provenance fails.
- CI and release workflows are part of the contract: `.github/workflows/{ci,release,docs}.yml` must stay green; SHA-pin any new third-party action and keep `permissions` least-privilege.

### Secrets

- Resolve credentials from configuration or environment only — explicit `token` in `createClient({ token })` or the `ERPBridge_TOKEN` env var. Keep token values out of code, logs, tests, and commits.
- When debugging or writing tests, assert header injection but never log the token value itself.
- Auth is consume-only: the SDK sends `Authorization: Bearer`; it never creates or revokes tokens (that is server-admin via bridgectl).

## Conventions

- Tool names on the wire are bare (`list_employees`), not `erp.`-prefixed — the proxy keys on exact registered names. Do not add prefix normalization without extending the plan.
- Public API ships dual ESM + CJS built with **tsdown** (`format: ['esm','cjs']`, `fixedExtension` → `.mjs`/`.cjs` + `.d.mts`/`.d.cts`). Keep the `exports` map in `package.json` in sync with `src/index.ts`; subpaths `./client`, `./rest`, `./types` mirror their source files. Named exports only — no `export default`.
- `@modelcontextprotocol/*` stays an external runtime dependency (never bundled into `dist/`).
- Errors are typed: always throw/forward the class hierarchy from `src/types.ts` (`ErpbridgeError` → `AuthenticationError` / `NotFoundError` / `RateLimitError` / `ServerError` / `ProtocolError`), never raw `Error` with string-matching.
- SSE parsing lives in one module and stays dependency-free; the server format is `data: <json>\n\n`.
- Node >= 20 — use built-in `fetch`, `AbortSignal`, and `AsyncIterable` rather than adding runtime dependencies.