# Changelog

## Unreleased

* MCP stdio server with 58 tools across market, account, orders,
  trading, portfolio, risk, paper, strategy, backtest, alerts,
  reconciliation, audit, system, auth, funding, and websocket groups.
* MCP resources and prompts for state inspection and guided workflows.
* Paper orders open then fill, with cancel refunds and file persistence.
* Alert persistence with cancel support.
* Audit file flush in JSON lines.
* Functional CLI calling shared services with live market reads.
* HTTP gateway dispatching the same tool surface with bridge-secret option.
* Daemon with bootstrap, reconcile, scheduled snapshots, and graceful shutdown.
* TAPI v2 base moved to api.indodax.com after live verification.
* Live order path uses signed TAPI v2 POST and DELETE with symbol.

## 1.0.1: foundation

* Layered workspace scaffold with strongly typed domain model.
* Isolated auth, transport, rate limiting, and exchange API layers.
* Explicit order lifecycle with reconciliation states.
* Deterministic risk engine with machine-readable reasons.
* Paper and live execution backends behind one `ExecutionBackend` trait.
* Agent intent contract separated from execution authority.
* Thin MCP tools with capability-gated mutations.
* File-backed storage, audit trail, event bus, scheduler, daemon lifecycle.
* CLI, MCP stdio server, HTTP gateway, and daemon binaries.
