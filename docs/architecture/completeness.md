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
| Live execution adapter | yes | constructed | adapter/signing | blocked by server policy |
| Reconciliation primitives | yes | partial | yes | not a full exchange reconciliation flow |
| Audit trail | yes | yes, in-memory | yes | application path |
| PostgreSQL schema | yes | package-level | real PG tests | not main runtime source of truth |
| DB repositories | yes | not main composition | repository tests | no |
| Alerts | yes | yes, in-memory | yes | application path |
| Strategies | yes | yes | yes | deterministic evaluation |
| Backtests | yes | yes | yes | in-process stored results |
| Event bus | yes | daemon | yes | daemon path |
| Scheduler | yes | daemon | yes | daemon lifecycle |
| Observability | yes | yes | yes | health/runtime path |
| MCP tools | 79 | yes | yes | protocol harness |
| MCP resources | 11 | yes | protocol | protocol path |
| MCP prompts | 5 | yes | protocol | protocol path |
| MCP metadata contracts | yes | guard for auth/environment | schema tests | handler plus risk checks stay downstream |
| HTTP gateway | yes | yes | yes | Playwright path |
| MCP stdio server | yes | yes | yes | consumer/protocol path |
| Deadman state machine | yes | yes | yes | state-machine coverage |
| CLI | yes | yes | yes | subprocess path |
| Daemon | yes | yes | yes | startup/lifecycle path |
| Workbench | yes | yes | render/E2E | browser path |
| Security controls | yes | handler/package level | yes | no live-order path |
| Deployment descriptors | yes | n/a | no | documented only |

## Current gaps

1. PostgreSQL is implemented as a database package but is **not the runtime source of truth**.
2. The MCP reconciliation tools are **not a complete local-versus-exchange reconciliation workflow**.
3. Some MCP risk callers supply fixed freshness values and null daily PnL, so risk context is **not fully authoritative** at every entrypoint.
4. The transport retry helper is **not idempotency-aware** for state-changing requests.
5. Live order placement is gated by `APP_ENV=live` plus credentials, acknowledgement, and risk approval. Withdrawal stays denied.

**Promote a capability to a stronger status only when** its wiring and tests are updated with it.
