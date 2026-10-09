<h1 align="center">Changelog</h1>

## 1.1.1

First published release of the TypeScript/Bun rebuild. Ships
`indodax-mcp` (stdio and Streamable HTTP server) and `@indodax-mcp/cli`.

Correctness and safety fixes in this release, each with regression coverage:

- **A stop refused for stale context is no longer retired.** The
  retryable-refusal classification was anchored to the first reason code in a
  risk denial, so a `STALE_ACCOUNT_STATE` or `STALE_MARKET_DATA` refusal that
  followed another reason was treated as terminal. The stop was marked `failed`
  and left the active list, silently removing downside protection from a
  position that was still open. Classification now inspects every reason code.
- **`indodax_ws_reconnect` reports partial success.** With `scope: "all"` and no
  credentials, the private leg threw outside its own handler, discarding a
  market leg that had already reconnected and reporting total failure. Each leg
  now reports independently, with `reasons` and a `partial` flag.
- **`indodax_alert_check` cannot report a consumed trigger as a false
  negative.** The scheduled alert autopoll and an agent-issued check share one
  store, so whichever ran first retired a matching alert and the other found
  nothing active. The response now carries `alreadyTriggered`, so
  `triggeredCount: 0` is distinguishable from "never fired", along with
  `priceSource`, `priceAgeMs` and `priceStale`.
- **`indodax_portfolio_snapshot` counts retired alerts.** A monitoring loop
  reading only `active` could not tell "nothing armed" from "it fired and
  someone already acted", so `alerts` now reports `triggered` and `cancelled`
  counts from the full history.
- **`indodax_candles` rejects unsupported timeframes locally.** `timeframe` was
  an unconstrained string, so aliases such as `1H`, `4H` and `D` each cost a
  live round trip and an HTTP 400 before failing. The schema is now an enum of
  the exchange-accepted set (`1`, `3`, `5`, `15`, `30`, `60`, `120`, `240`,
  `1D`, `3D`, `1W`, `1M`) and names the valid options on refusal. The response
  also attributes rows to a pair, timeframe and window instead of returning a
  bare array.
- **`indodax_ticker` states its price quality.** A cached row up to 13s old
  reported a spread that could differ from the live orderbook by more than half
  a percentage point, with nothing in the response to say so. The response now
  carries a `dataQuality` block and an envelope warning on a cache hit.
- **`indodax_open_orders` reports read provenance.** `source` and `observedAt`
  accompany the order set, so a count that differs from a sibling tool seconds
  later can be attributed to exchange propagation rather than a stale read.
  Both open-order surfaces now expose the same fields.
- **The server version lives in one module** and is asserted against both
  publishable manifests, so a release cannot ship a server that misreports
  which release it is.

Documentation corrected against the implementation: the published tool count
(91, previously stated as 88 or 89), the per-area guide index rows, the candles
response shape and timeframe set, the alert parameter shape and consumption
semantics, the open-order and ticker provenance fields, and the stop outcomes
in the execution-flow and trading-mode diagrams.

### Shipped surface

- Bun workspaces with Turborepo, Biome, strict TypeScript, and Vitest.
- Official MCP SDK v2 infrastructure with shared registry, stdio, Streamable HTTP, contracts, and test harnesses.
- **91 MCP tools**, **12 resources**, and **5 prompts**.
- INDODAX public REST, TAPI v2 signing, authenticated account/history reads, and WebSocket protocol primitives.
- Explicit order lifecycle and deterministic risk evaluation.
- Paper execution through the shared execution service.
- Live execution gated by `APP_ENV=live` plus `TRADE_ENABLED=true`, credentials, acknowledgement, and risk approval.
- Server-side emulated stops with trigger checks, plus timeInForce and self-trade prevention passthrough.
- Live private channel over the official WebSocket dialect with token fetch.
- Strategy evaluation, deterministic backtests, portfolio analytics, alerts, audit, scheduler, events, observability, and operational tooling.
- PostgreSQL schema, migrations, and repository implementations.
- CLI, daemon, HTTP gateway, and React workbench.
- Automated test/build tooling plus consumer verification utilities.

### Current capability boundary

The main application composition defaults to **paper**. Live order and cancel run through the risk-guarded path when `APP_ENV=live` plus `TRADE_ENABLED=true` with credentials and acknowledgement. PostgreSQL mirrors paper, audit, alerts, and stops when configured but is **not yet the main runtime source of truth**, and the MCP reconciliation surface is **not yet a full exchange-state reconciliation workflow**.

## 1.0.1: foundation (Rust)

The original Rust release established the behavioral reference for the current rebuild: layered exchange access, typed financial models, explicit order lifecycle, deterministic risk, paper/live execution abstraction, agent intent boundaries, MCP tools, storage, events, scheduling, and operational processes.
