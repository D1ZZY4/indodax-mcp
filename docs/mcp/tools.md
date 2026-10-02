# MCP tools

MCP handlers are thin: deserialize, validate, call a service, serialize
a stable `McpResponse`.

* `market_*`: read-only, no auth. Stale snapshots carry timestamps.
* `account_*`: read-only, require credentials upstream.
* `trading propose`: validates intent, runs risk, never executes directly.
* `paper_*`: isolated paper backend only.
* `risk_*`: read-only limits and policy inspection.
* `system_*`: health, metrics, and capability matrix.

Mutations need stronger guards than reads. Withdrawal stays on the
separate `funding.withdraw` capability and is disabled by default.
