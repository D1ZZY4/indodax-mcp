# Audit continuation state

## Task status

COMPLETE. Full read done, baseline established, twelve findings confirmed and
eleven fixed, final gate green.

## Full-read status

COMPLETE. Every tracked file outside node_modules, dist, .git internals, and
build output was read in full.

## Workspace packages inspected

39 of 39 (34 libraries, 5 apps).

## Applications inspected

apps/mcp-stdio, apps/mcp-http, apps/cli, apps/daemon, apps/mcp-workbench.

## Confirmed findings

F-001 HIGH FIXED: packages/db/test/db.test.ts treated an ambient DATABASE_URL as
a disposable database. It applied every migration with client.unsafe(sql) and
inserted a tenant row, with no isolation and no cleanup, so a second run failed
with `relation "alerts" already exists` and test tables were written into the
developer's real database. Migrations are bare CREATE TABLE scripts with no IF
NOT EXISTS, and the suite assumed a fresh CI service container. Fixed with a
per-run disposable database, dropped in afterAll. Verified: three consecutive
forced runs pass, zero user tables left, no leaked database.

F-002 MEDIUM FIXED: apps/mcp-workbench/src/pages/Paper.tsx called
indodax_paper_status, removed in 2.0.0, so the page rendered an error. Fixed to
indodax_paper_ledger with view status. Duplicated envelope parsing in Paper.tsx
and Health.tsx consolidated into callTool plus ToolEnvelope in api/mcp.ts.

F-003 MEDIUM FIXED: prompts.ts indodax_incident_review instructed the agent to
call indodax_execution_trace and indodax_reconciliation_state, both removed in
2.0.0. Fixed to indodax_audit with correlationId plus indodax_reconcile_paper.

F-004 LOW FIXED: packages/indodax-auth/src/rejections.ts pointed operators at
indodax_balances, removed in 2.0.0, in two guidance strings. Changed to
indodax_account, with six test assertions and docs/tools/orders.md updated.

F-005 INFORMATIONAL NOT FIXED: Playwright browser specs cannot run in this
environment. Chromium installs but fails to launch: libglib-2.0.so.0 and nine
other system libraries are absent and the sandbox has no root. The non-browser
spec tests/e2e/http.spec.ts passes. Recorded as NOT RUN.

F-006 HIGH FIXED: apps/daemon registered SIGINT/SIGTERM handlers inside main(),
after the module graph was composed. Composition takes roughly 190ms, so a
signal in that window killed the process by default disposition: exit 143, no
hooks, no clean-exit line, no output. Static imports cannot fix this because
the bundler hoists the graph; measured directly. Fixed with src/signals.ts
installed through a runtime preload, plus src/launch.ts emitting
dist/indodax-daemon that passes --preload with a path resolved from its own
location. A shebang cannot carry the flag (env looks for a program named
"bun --preload x") and bunfig.toml is cwd-relative, so both were rejected by
measurement. Verified clean shutdown at 0.05s, 0.2s and 0.5s from source, from
the built launcher, and from the packed tarball run outside the monorepo.

F-007 MEDIUM FIXED: apps/daemon/test/daemon.test.ts, both apps/mcp-http specs,
and scripts/verify-consumer.ts spawned subprocesses with the ambient
environment, so DATABASE_URL reached them. Each attached five persistence
mirrors to the developer's real database, mutating it and making startup
depend on its latency. That is what made the daemon suite fail intermittently
under parallel load. Fixed by clearing DATABASE_URL in the spawned
environment, matching the pattern the CLI suite already used. Verified: five
daemon runs and three full-suite runs all pass.

F-008 LOW FIXED: apps/mcp-http/README.md claimed "91 tools" and that GET
/health returns "the server version, overall health, and persistence state".
The registry exposes 68, and /health returns only status, server, version, and
mode. Both corrected against the live registry and a real gateway.

F-009 LOW FIXED: docs stated the workspace published at 1.1.1 (overview.md,
completeness.md, two self-hosting examples) while every manifest and the live
registry are 2.0.0. Corrected against the actual value.

F-010 LOW FIXED: two live strings in packages/indodax-mcp/src/tools/history.ts
told the caller to cross-check indodax_reconcile_full, removed in 2.0.0.
Corrected to indodax_reconcile_exchange with scope full.

F-011 INFORMATIONAL: bun.lock records all 40 workspace entries at 1.1.1 while
every manifest says 2.0.0. Pre-existing from the 2.0.0 release commit.
Verified harmless for publishing: bun pm pack rewrites workspace specs from the
manifest, and bun run release:dry reports 2.0.0 for every package.

## MCP surface change

tools before 68 / after 68
resources before 12 / after 12
prompts before 5 / after 5
tools removed: none
tools added: none
resources added: none
prompts added: none
inputs narrowed: none

Verified against the live registry object, not source alone. No tool, resource,
or prompt was added or removed in this task. The Jev advisory was attached to an
existing tool response rather than becoming a tool.

## Regression coverage added

1. packages/indodax-mcp/test/surface-references.test.ts. Four guards: workbench
   callTool arguments, prompt text through the live MCP harness, the shipped
   rejection guidance, and tool descriptions with retirement prose excluded.
   Each resolves referenced names against the live registry. Verified to fail
   when F-002, F-003, F-004 and F-010 are each reintroduced.
2. packages/indodax-mcp/test/surface-counts.test.ts gained a package-README
   count guard. Verified to fail with "tools 91 != 68" when F-008 returns.
3. apps/mcp-stdio/test/runtime-verification.test.ts. Exercises the packaged
   stdio binary over a real handshake: surface counts, one tool per functional
   category (18 categories), the typed error envelope, the full paper order
   lifecycle, and startup announcement plus SIGTERM handling.
4. apps/daemon/test/daemon.test.ts gained a boot-window shutdown test. Verified
   to fail when the preload is disabled and to pass with it.
5. packages/indodax-mcp/test/jev.test.ts. Eight contract tests for the Jev
   client: well-formed response, low confidence, six malformed shapes, HTTP
   401, transport failure, timeout, missing credential, free-model-only
   assertion, and out-of-range clamping.

## MCP verification path

Repository MCP client harness over in-memory transport, plus the packaged stdio
binary spawned exactly as an MCP host would launch it, plus a real HTTP gateway
probed over the network. All three used. Results recorded in the final report.

## Dependency work

Applied: @types/node 26.6.4 to 26.6.5, bun-types 1.4.2 to 1.4.3, drizzle-orm
0.45.3 to 0.45.4, vite 8.3.3 to 8.3.4. Typecheck, test and build clean after.

Not applied, deliberately: @playwright/test 1.63.0 to 1.64.0 (the browser suite
cannot run here to verify) and lucide-react 1.52.0 to 1.55.0 (icon-only, same
verification gap).

No dependency added. bun audit still reports the single documented esbuild
advisory, reachable only through drizzle-kit, a devDependency absent from all
four shipped bundles. drizzle-kit 0.31.11 is the current published release.

## Jev Model integration

Status: IMPLEMENTED AND TESTED. Live authenticated invocation NOT POSSIBLE here.

Evidence: the live model catalog returns jev-1.13 and jev-1.13-free; the
official docs state jev-1.13-free is Free on all four token columns; the
System One endpoint contract was verified by live probe, returning
{"answers":{"q":{"type":"noul","noul":0.96}},"usage":{...}}. Determinism was
confirmed: identical requests twice returned 0.96 and 0.96, a contradicting
state returned 0.06, an empty state 0.83. All three question shapes were
captured live.

Blocker: no real OPENCODE_API_KEY exists in this environment, so the end-to-end
authenticated call could not be executed and is NOT claimed as verified. The
HTTP 401 path is exercised by a test.

Implementation: packages/indodax-mcp/src/jev.ts, annotated onto the existing
indodax_strategy_evaluate response under `advisory`. No new tool, resource,
prompt, package, or dependency.

Safety: only the free model is ever used so no charge is possible; the advisory
cannot gate or approve anything; every failure degrades to available false; only
pair, side, strength and close count are sent, never credentials or account
state.

## Files created

packages/indodax-mcp/src/jev.ts
packages/indodax-mcp/test/surface-references.test.ts
packages/indodax-mcp/test/jev.test.ts
apps/mcp-stdio/test/runtime-verification.test.ts
apps/daemon/src/signals.ts
apps/daemon/src/launch.ts
apps/daemon/bunfig.toml
docs/audit/audit-state.md

## Files modified

packages/db/test/db.test.ts
packages/indodax-auth/src/rejections.ts
packages/indodax-auth/test/rejections.test.ts
packages/indodax-execution/test/execution.test.ts
packages/indodax-execution/test/rejection-translation.test.ts
packages/indodax-mcp/src/prompts.ts
packages/indodax-mcp/src/tools/history.ts
packages/indodax-mcp/src/tools/strategy.ts
packages/indodax-mcp/test/surface-counts.test.ts
packages/indodax-mcp/test/stop-blocked.test.ts
apps/daemon/src/main.ts
apps/daemon/package.json
apps/daemon/test/daemon.test.ts
apps/mcp-http/test/http.test.ts
apps/mcp-http/test/streamable-http.test.ts
apps/mcp-workbench/src/api/mcp.ts
apps/mcp-workbench/src/pages/Health.tsx
apps/mcp-workbench/src/pages/Paper.tsx
scripts/verify-consumer.ts
package.json
bun.lock
.env.example
apps/mcp-http/README.md
docs/tools/strategy.md
docs/tools/orders.md
docs/operations/self-host-operations.md
docs/architecture/completeness.md
docs/architecture/overview.md
docs/guides/self-hosting.md

## Files deleted

None.

## Validation executed

- bun install --frozen-lockfile: exit 0.
- bun run format:check: exit 0, 360 files.
- bun run lint: exit 0, 361 files.
- bunx turbo typecheck: exit 0, 71 tasks.
- bunx turbo test: exit 0, 78 tasks. Repeated three times consecutively green
  after the daemon fix.
- bunx turbo build: exit 0, 39 tasks.
- bunx playwright test: exit 1. tests/e2e/http.spec.ts passes (1/1). The four
  browser specs fail at launch on missing system libraries. NOT RUN for the
  browser specs, for the reason recorded in F-005.
- bun audit: 1 moderate advisory, the documented esbuild finding, confirmed
  absent from all four shipped bundles.

## Remaining scope

None for the environment. The only open items are F-005, which needs system
libraries this sandbox cannot install, and the Jev authenticated call, which
needs a credential that does not exist here.
