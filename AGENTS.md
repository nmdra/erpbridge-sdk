# AI Agent Guide

TypeScript client library for the ERPBridge server family: `@erpbridge/sdk`. Wraps `@modelcontextprotocol/client` (v2) plus typed REST wrappers (logs, metrics, health, cache, tool registry, invoke). Consumed by application and AI-agent developers embedding ERPBridge in their own products.

## Development Rules

Rules for agents making changes to this repository.

### Plan first

- Read the active plan before coding: `.agents/plans/Plan.md`. Implement tasks in order and tick each checkbox as it completes.
- Each plan task carries a `Verify:` command — the task is done only when that command is green.
- **`.agents/plans/Plan-auth.md` is a FUTURE plan — do not implement it.** It covers SDK auth and stays dormant until the ERPBridge server's own auth (`ERPBridge/.agents/plans/Plan-Auth.md`) ships.
- Open a plan (or extend it) for any work the plans don't cover.

### Small commits

- One plan task = one commit. Keep commits small and single-purpose; separate unrelated changes into their own commits.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `build:`, `refactor:`, `test:`) — the git-commiter skill handles message generation and staging.
- Never commit generated artifacts (`dist/`, `node_modules/`, `*.tgz`).

### TDD

- Follow the tdd skill workflow: write the failing test first (red), watch it fail, implement the minimum (green), then refactor.
- Tests live beside the code they cover (`src/*.test.ts`) with `vitest`. Use the `node:http` fixture servers (under `fixtures/`) for hermetic HTTP/MCP tests — do not mock `fetch` or the MCP SDK.
- Add a test for every behavior change; a change without a test is not complete.
- Live integration tests go under `tests/integration/`, gated behind the `ERPBridge_TEST_SERVER` env var (skipped when unset).

### Test reporting & scratch

- **`.agents/plans/Plan-testing.md` is the testing plan** — read it before running or writing tests. It defines report capture, the report format, and the self-evolution loop (failure/flake = hard trigger; session-start scan; milestone promotion).
- Save a **summarized, agent-readable report** of any test run that matters (unexpected failures, flakes, new scenarios, discoveries) to `.scratch/testing/` — `YYYY-MM-DDTHHMMSSZ_<scope>_<topic>_<kind>.md` + one valid JSON object per line in `index.jsonl`. Expected TDD-red runs and routine green runs are usually skipped — use judgment.
- `.scratch/` is an **uncommitted git repo** (gitignored from this repo) for anything valid to future development: `testing/` (test reports), `research/` (findings), `decisions/` (major decisions), `rca/` (bug root-cause analyses), `summaries/`. Descriptive file names. **Never commit `.scratch/` contents unless the user explicitly asks.**

### Quality gates

- Run `npm test` and `npm run build` before finishing any task; run `npm run lint:publish` (publint + attw --pack on the tarball) for anything that ships in the package.
- Behavior changes update README.md and CHANGELOG.md (Unreleased) in the same commit.
- Product-facing documentation lives in the **erpbridge-docs** repo under `docs/sdk/` (single source of truth) — update it in the same commit as the behavior, and run `npm run build` there to verify links.

### Release pipeline

- Versions and changelogs come from **release-please** (Conventional Commits drive bumps: `fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` footer → major). Never hand-edit `CHANGELOG.md` version entries or bump the version field yourself — the release PR does it. Write Unreleased entries only.
- Publishing uses **npm Trusted Publishing (OIDC)** from CI — no `NODE_AUTH_TOKEN`, provenance is automatic. `package.json` `repository.url` must exactly match the GitHub repo or provenance fails.
- **Every release ships with a documentation update** in the **erpbridge-docs** repo: user-facing SDK changes are documented under `docs/sdk/` in the same release cycle, and `docs/sdk/agent-guide.mdx` there is kept in sync with this AGENTS.md. Open that docs PR alongside the release PR.
- CI and release workflows are part of the contract: `.github/workflows/{ci,release}.yml` must stay green; SHA-pin any new third-party action and keep `permissions` least-privilege. API reference docs live in the erpbridge-docs site (`docs/sdk/api-reference.mdx`), not in a Pages workflow.

### Secrets

- **v1 ships auth-free by design** (plan decision D17): no token resolution, no bearer injection, no `ERPBridge_TOKEN` handling. The `token`/`tokenEnv` config fields exist but are inert.
- Never log server responses' `Authorization`/`WWW-Authenticate` header values in tests or debug output.
- Auth behavior (token resolution, injection, 401 mapping, scope awareness) is implemented only under the future `.agents/plans/Plan-auth.md` — keep it out of v1 code and commits.

## Conventions

- Tool names on the wire are bare (`list_employees`), not `erp.`-prefixed — the proxy keys on exact registered names. Do not add prefix normalization without extending the plan.
- Public API ships dual ESM + CJS built with **tsdown** (`format: ['esm','cjs']`, `fixedExtension` → `.mjs`/`.cjs` + `.d.mts`/`.d.cts`). Keep the `exports` map in `package.json` in sync with `src/index.ts`; subpaths `./client`, `./rest`, `./types` mirror their source files. Named exports only — no `export default`.
- `@modelcontextprotocol/*` stays an external runtime dependency (never bundled into `dist/`).
- Errors are typed: always throw/forward the class hierarchy from `src/types.ts` (`ErpbridgeError` → `AuthenticationError` / `NotFoundError` / `RateLimitError` / `ServerError` / `ProtocolError`; future auth adds `AuthorizationError`), never raw `Error` with string-matching.
- SSE parsing lives in one module and stays dependency-free; the server format is `data: <json>\n\n`.
- Node >= 20 — use built-in `fetch`, `AbortSignal`, and `AsyncIterable` rather than adding runtime dependencies.
