# Risk register

## R1: No system PostgreSQL in build environment

No server binaries, no Docker, no passwordless sudo. Mitigation:
`embedded-postgres` supplies real PostgreSQL binaries for
dev/test/CI behind the same `postgres.js` plus Drizzle path used in
production. Residual: first test run downloads binaries (network).

## R2: TypeScript 7 on latest tag

Registry `latest` points at the native 7.x preview. Mitigation: pin
TypeScript 5.9 line until SDK and Vitest/Playwright explicitly
support 7.x. Residual: none while pinned.

## R3: MCP SDK v2 API drift

Installed 2.2.0 may differ from prompt-time examples. Mitigation:
Context7-verified `registerTool`, `serveStdio`,
`createMcpHandler`/`createMcpHonoApp`, client auto negotiation.
Residual: re-verify exports right after install; record deviations.

## R4: Trade API v2 key separation

v2 needs a dedicated key plus IP whitelist; the operator key in this
environment is v2-typed but its IP grant is unverified. Mitigation:
live verification stays read-only; -2015 is an expected environment
outcome, not a code defect. Residual: live trading unverifiable here.

## R5: Public throttle vs official limit

App default 7 rps exceeds official public 180/min if applied to
public reads. Mitigation: per-endpoint buckets from the official
table; 7 rps documented as application safety default only.
Residual: none after bucket implementation.

## R6: v1 history decommission

`tradeHistory`/`orderHistory` dead since 2026-04-07. Mitigation:
v2 endpoints are the only preferred path; legacy isolated.
Residual: none.

## R7: Monorepo size vs context

50+ packages in one autonomous session. Mitigation: phased gates,
small focused files (350/375), shared core first. Residual:
schedule pressure on workbench E2E; contract tests cover the seam.

## R8: POST retry idempotency for live orders

`fetchWithRetry()` retries POSTs including state-changing requests.
Live orders carry `newClientOrderId`, but exchange-side dedup
semantics are unverified. Mitigation: live order path stays locked
behind policy plus acknowledgement, and unknown outcomes reconcile
before any retry. Residual: prove idempotency against the exchange
before enabling live execution.
