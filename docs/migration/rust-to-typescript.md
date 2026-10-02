# Rust to TypeScript responsibility mapping

Reference: [Recon](recon.md) (observed Rust behavior).

| Rust source | TypeScript destination | Notes |
|---|---|---|
| `indodax-core` money/asset/ids/time/events | `packages/core` | Decimal.js replaces rust_decimal at boundary |
| `indodax-core` errors | `packages/errors` | 10 categories preserved, retryability preserved |
| `indodax-core` risk_types/execution/orders/portfolio | `packages/core` domain | 14 order states become 11 execution states per spec |
| `indodax-config` | `packages/config` | TOML files kept, parsed with typed loader |
| `indodax-secrets` | `packages/secrets` | Redacted debug plus zeroize-equivalent handling |
| `indodax-auth` | `packages/indodax-auth` | TapiV2Signer, LegacyTapiSigner, WsTokenSigner split |
| `indodax-transport` + `indodax-rate-limit` | `packages/transport` | fetch-based retry plus multi-bucket limiter |
| `indodax-api` | `packages/indodax-client` | Same paths/envelopes, zod-validated DTOs |
| `indodax-market` | `packages/indodax-market` | Same normalization plus cache plus staleness |
| `indodax-account` | `packages/indodax-account` | Same reads, v1 histories marked legacy |
| `indodax-websocket` | `packages/indodax-websocket` | Native WS, offset recovery, private token flow |
| `indodax-order` machine | `packages/indodax-orders` state | Legal-edge table preserved |
| `indodax-order` reconcile | `packages/indodax-reconciliation` | Local vs exchange vs fills vs balances |
| `indodax-risk` | `packages/indodax-risk` | Pure evaluate plus extended checks (balance, increments, kill switch, deadman) |
| `indodax-execution` | `packages/indodax-execution` | Backend interface plus risk-guarded service |
| `indodax-paper` | `packages/indodax-paper` | Same ledger semantics on Drizzle storage |
| `indodax-trading` | `packages/indodax-trading` | Same propose/review pipeline |
| `indodax-agent` | `packages/indodax-agent` | Orchestration only, no LLM SDK |
| `indodax-strategy` | `packages/indodax-strategy` | Signal-only contract |
| `indodax-backtest` | `packages/indodax-backtest` | Deterministic replay plus metrics |
| `indodax-portfolio` | `packages/indodax-portfolio` | Equity/PnL/exposure on Decimal |
| `indodax-alerts` | `packages/indodax-alerts` | Condition evaluation plus persistence |
| `indodax-audit` | `packages/indodax-audit` | Append trail on Drizzle |
| `indodax-storage` | `packages/storage` | Drizzle repositories replace FileStore |
| `indodax-event-bus` | `packages/events` | Typed event map replaces stringly bus |
| `indodax-scheduler` | `packages/scheduler` | Owned jobs with shutdown |
| `indodax-observability` | `packages/observability` | Health plus counters plus OTEL boundaries |
| `indodax-mcp` tools/resources/prompts | `packages/indodax-mcp` plus `mcp-*` | Registry metadata, SDK v2 registration |
| `indodax-gateway` + `indodax-oauth` | `apps/mcp-http` (Hono plus adapter) | Bridge-secret model kept, full OAuth out |
| `indodax-daemon` | `apps/daemon` | Same lifecycle phases |
| `indodax-cli` | `apps/cli` | citty commands over services |
| new | `apps/mcp-stdio`, `apps/mcp-workbench` | stdio runtime, React workbench |
| new | `packages/indodax-deadman` | No Rust equivalent (was missing) |
| new | `packages/mcp-core/runtime/contracts/registry/security/tools/resources/prompts/transport/testing` | Generic MCP infrastructure split |

## Behavior deltas (intentional)

- Order lifecycle narrows to the 11-state execution model from the
  spec; the 14-state Rust machine maps onto it (Proposed to NEW,
  Validating/RiskCheck internal, Rejected to REJECTED, Approved to
  ACCEPTED path, SubmitFailed to REJECTED, Open to ACCEPTED,
  PartiallyFilled kept, CancelRequested to CANCELLING).
- v1 `tradeHistory`/`orderHistory` kept only as isolated legacy
  helpers for migration tests, never the preferred path.
- TAPI v2 STP uses EXPIRE_* values; legacy uses MAKER/TAKER/BOTH.
- Public default throttle stays 7 rps as application safety default;
  official 180/min and endpoint tables remain authoritative.
