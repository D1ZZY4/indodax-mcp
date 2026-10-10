<h1 align="center">Completeness matrix</h1>

This matrix describes the **current repository state**, not the intended architecture.

Definitions:

- Implemented: relevant code exists.
- Wired: capability is connected to the current application composition.
- Tested: automated tests cover the capability at some level.
- End-to-end: the intended external path is exercised without relying only on unit-level mocks.

| Capability | Implemented | Wired | Tested | End-to-end |
| --- | --- | --- | --- | --- |
| Public REST market | yes | yes | yes | adapter path |
| Market WebSocket | yes | yes | protocol | one-shot snapshot path |
| Account reads | yes | yes | yes | authenticated adapter path |
| Order model/lifecycle | yes | yes | yes | paper lifecycle |
| Trading service | yes | yes | yes | paper proposal/review |
| Risk engine | yes | yes | yes | deterministic evaluation |
| Portfolio | yes | yes | yes | paper state with market valuation |
| Paper execution | yes | yes | yes | MCP/CLI path |
| Live execution adapter | yes | yes, gated | adapter/signing plus mocked submit/cancel | live reads verified real; live placement covered by mocks plus one user-driven order, no automated live path |
| Reconciliation primitives | yes | partial | yes | not a full exchange reconciliation flow |
| Audit trail | yes | yes, memory-first plus Postgres mirror | yes | application path |
| PostgreSQL schema | yes | package-level | real PG tests | mirror verified live for alerts; not the main runtime source of truth |
| DB repositories | yes | yes when DATABASE_URL is set, else memory | repository tests | mirror path for paper, audit, alerts, stops |
| Alerts | yes | yes, memory-first plus Postgres mirror | yes, including restore | application path |
| Stop orders | yes | yes, memory-first plus Postgres mirror | yes, trigger plus restore | paper trigger path; live trigger covered by mocks |
| Private channel | yes | yes, on demand | yes, dialect plus mocked token | live connect verified once; no continuous live-traffic test |
| Strategies | yes | yes | yes | deterministic evaluation |
| Backtests | yes | yes | yes | in-process stored results |
| Event bus | yes | daemon | yes | daemon path |
| Scheduler | yes | daemon plus opt-in server autopoll | yes | daemon lifecycle |
| Observability | yes | yes | yes | health/runtime path |
| MCP tools | 68 | yes | yes | protocol harness |
| MCP resources | 12 | yes | protocol | protocol path |
| MCP prompts | 5 | yes | protocol | protocol path |
| MCP metadata contracts | yes | guard for env/credentials plus tool annotations on every tool | schema tests, guard and annotation tests | handler plus risk checks stay downstream |
| HTTP gateway | yes | yes | yes | Playwright path |
| MCP stdio server | yes | yes | yes | consumer/protocol path |
| Deadman state machine | yes | yes | yes | state-machine coverage |
| CLI | yes | yes | yes | subprocess path |
| Daemon | yes | yes | yes | startup/lifecycle path |
| Workbench | yes | yes | render/E2E | browser path |
| Security controls | yes | handler/package level | yes | live path gated and mocked; no automated live-order path |
| Deployment descriptors | yes | n/a | no | documented only |
| npm publication | yes | yes, all 39 packages | pack plus clean-room install | installed and executed from the registry: stdio handshake, HTTP health, CLI help, daemon lifecycle |

## Current gaps

1. PostgreSQL is implemented as a database package but is **not the runtime source of truth**.
2. The MCP reconciliation tools are **not a complete local-versus-exchange reconciliation workflow**.
3. Risk context resolves from live market reads, account sync state, ledger trade counts, and Deadman state. A market never reached stays unknown rather than fresh.
4. State-changing requests attempt exactly once by default and opt into retries only with proven idempotency. Paper placement replays repeated client order ids.
5. Live order placement is gated by `APP_ENV=live` plus `TRADE_ENABLED=true`, credentials, acknowledgement, and risk approval. Withdrawal stays denied.
6. Reconciliation halt is re-derived inside `resolveRiskContext` rather than cached, so the trading gate cannot be moved by calling a read-only tool. The cost is one extra ledger snapshot per risk evaluation.
7. Signed TAPI v2 reads rebuild the signature per retry attempt. The previous single-signature reuse could exceed `recvWindow` and convert a transient failure into a permanent timestamp rejection.
8. Published at 2.0.0, which consolidated the tool surface from 91 tools to 68. Every workspace package moves on one lockstep version line, so the manifest version, the `SERVER_VERSION` constant, and the registry `latest` tag are all 2.0.0.

**Promote a capability to a stronger status only when** its wiring and tests are updated with it.
