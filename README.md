# Indodax MCP

Indodax MCP is a rebuild of `indodax-cli` from
`https://github.com/ibidathoillah/indodax-cli` by ibidathoillah,
rebuilt for high flexibility and extended features under the name
Indodax MCP. Usage is expanded for AI agents, humans, and developers.

Modular, production-oriented scaffold. Licensed under SSPL v1,
copyright D1ZZY4. The original repository license is preserved in
`LICENSE_COPY/`.

## Layout

* `crates/` — domain and infrastructure crates with explicit boundaries.
* `apps/` — thin binaries (`cli`, `mcp-server`, `mcp-http`, `daemon`).
* `tests/`, `docs/`, `config/`, `deploy/`, `examples/`, `scripts/`.

## Execution boundary

```text
Agent/MCP/CLI
→ TradingService
→ RiskEngine
→ ExecutionService
→ Paper | Live backend
→ Indodax API
```

No path from MCP, agent intent, or strategy directly to live order
placement. Withdrawal requires a separate `funding.withdraw` capability.

## MCP surface

58 tools across market, account, orders, trading, portfolio, risk,
paper, strategy, backtest, alerts, reconciliation, audit, system,
auth, funding, and websocket groups, plus 7 resources and 5 prompts.
See `docs/mcp/surface.md`. Transports (`indodax-mcp-server` stdio and
`indodax-mcp-http`) share one dispatch, so behavior is identical.

## Modes

* `paper` (default, safe)
* `live` (explicit opt-in)
* `development`

Live mode never activates implicitly from credentials alone.

## Docs

* `docs/architecture/` — system overview.
* `docs/adr/` — architecture decision records.
* `docs/migration/` — v1 → v2 mapping.
* `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`.
