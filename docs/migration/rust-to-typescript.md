<h1 align="center">Rust to TypeScript responsibility mapping</h1>

This page maps the original Rust responsibilities to the current Bun/TypeScript repository. It is a migration reference, not a statement that every mapped capability is fully integrated at runtime.

| Rust responsibility | TypeScript location | Current note |
| --- | --- | --- |
| Core money, assets, ids, time, events | packages/core | Decimal-based domain helpers and canonical types |
| Core errors | packages/errors | Typed application and exchange errors |
| Risk and execution types | packages/core, packages/indodax-risk, packages/indodax-execution | Split across generic domain and execution packages |
| Configuration | packages/config | Typed environment parsing |
| Secrets | packages/secrets | Secret wrappers |
| Authentication | packages/indodax-auth | TAPI v2 HMAC-SHA256 and legacy HMAC-SHA512 paths |
| Transport and rate limits | packages/transport | Fetch/retry and bucket primitives |
| REST API | packages/indodax-client, packages/indodax-account | Public and authenticated adapter layers |
| Market | packages/indodax-market | Normalization and cache |
| WebSocket | packages/indodax-websocket | Market-style protocol and managed socket primitives |
| Order lifecycle | packages/indodax-orders | Canonical order record and transition machine |
| Reconciliation | packages/indodax-reconciliation | Local/exchange comparison primitives |
| Risk | packages/indodax-risk | Deterministic policy engine |
| Execution | packages/indodax-execution | Shared backend contract plus live adapter |
| Paper trading | packages/indodax-paper | In-memory paper ledger |
| Trading orchestration | packages/indodax-trading | Intent, proposal, validation, and risk review |
| Strategy | packages/indodax-strategy | Signal generation |
| Backtest | packages/indodax-backtest | Deterministic replay and reports |
| Portfolio | packages/indodax-portfolio | Equity, PnL, and exposure calculations |
| Alerts | packages/indodax-alerts | In-memory alert state |
| Audit | packages/indodax-audit | In-memory audit trail |
| Deadman | packages/indodax-deadman | Current TypeScript state machine |
| Events | packages/events | Typed event bus |
| Scheduler | packages/scheduler | Interval jobs and shutdown |
| Observability | packages/observability | Health and counters |
| Generic MCP infrastructure | packages/mcp-* | Contracts, registry, runtime, testing |
| MCP application | packages/indodax-mcp | Tool/resource/prompt composition |
| Gateway | apps/mcp-http | Hono-based HTTP adapter |
| Stdio server | apps/mcp-stdio | MCP stdio application |
| CLI | apps/cli | CLI application |
| Daemon | apps/daemon | Operational process |
| Workbench | apps/mcp-workbench | React/Vite workbench |

## Intentional deltas

- The current repository is a Bun monorepo; the Rust crate layout is historical.
- There is no standalone indodax-agent package. Agent intent and proposal types live in the trading/MCP contract boundary.
- PostgreSQL replaces the Rust file-store direction at the package level, but database state is not yet the source of truth for the main application composition.
- The current server policy supports paper execution only.
- The old browser OAuth flow is not ported to the current HTTP gateway.
- TAPI v2 uses HMAC-SHA256; legacy v1 compatibility uses HMAC-SHA512.
- The current order lifecycle is implemented in the TypeScript order package and should be treated as the canonical current state model.

For current implementation status, see [Completeness](../architecture/completeness.md).
