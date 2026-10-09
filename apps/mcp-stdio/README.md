# indodax-mcp

MCP server for [INDODAX](https://indodax.com) spot trading: market reads, paper
execution, deterministic risk review, server-side emulated stops, and a gated
live path.

**Paper execution is the default. Withdrawal is denied by design and has no
server-side grant path.** Live order placement requires `APP_ENV=live` plus
`TRADE_ENABLED=true`, credentials, explicit per-call acknowledgement, and a risk
`ALLOW` verdict. Every one of those gates must hold on every call.

> Unofficial community software, not affiliated with or endorsed by INDODAX.
> Cryptocurrency trading can result in loss of funds.

## Install

```bash
bun add -g indodax-mcp
```

Requires the Bun runtime (the published binary has a `#!/usr/bin/env bun`
shebang and is built with `bun build --target bun`).

## Transports

The same registry serves both transports.

stdio, for an MCP host such as OpenCode:

```json
{
  "mcp": {
    "indodax": {
      "type": "local",
      "command": ["bun", "-y", "indodax-mcp"],
      "enabled": true,
      "environment": {}
    }
  }
}
```

Streamable HTTP:

```bash
INDODAX_API_KEY=... INDODAX_API_SECRET=... bunx indodax-mcp
```

The gateway binds `127.0.0.1` on port 8000 by default. Override with `MCP_HOST`
and `MCP_PORT`. Containers must set `MCP_HOST=0.0.0.0`, because a process bound
to loopback inside a container never receives the bridge-forwarded connection.
Do not expose the gateway publicly without designing an authentication and
network-security boundary; it does not ship one.

## Configuration

Public market reads and paper trading need no credentials.

| Variable | Purpose |
| --- | --- |
| `INDODAX_API_KEY` | TAPI v2 key, required for authenticated reads |
| `INDODAX_API_SECRET` | TAPI v2 secret |
| `INDODAX_RATE_LIMIT` | Application throttle in requests per second |
| `INDODAX_WS_TOKEN` | Market WebSocket token, falls back to the public default |
| `DATABASE_URL` | PostgreSQL, mirrors paper, audit, alerts, stops and deadman |
| `APP_ENV` | `paper` (default), `development`, or `live` |
| `TRADE_ENABLED` | Required for any live order or cancel |
| `MCP_HOST` | Gateway bind address, default `127.0.0.1` |
| `MCP_PORT` | Gateway port, default `8000` |
| `STOP_AUTOPOLL_MS` | Interval for evaluating server-side stops |
| `ALERT_AUTOPOLL_MS` | Interval for evaluating price alerts |

Without `DATABASE_URL` the server runs entirely in memory and a restart loses
paper, audit, alert, stop and deadman state. `indodax_config_status` reports
reachability rather than mere presence of the variable, so a configured but
unreachable mirror is visible as `configured_unreachable`.

## What the server does not do

- **Withdrawal.** `indodax_funding_withdraw` always returns
  `AuthorizationError`. There is no flag that enables it.
- **Guarantee a fill.** Paper fills are manual through `indodax_paper_fill`.
  Acceptance is not a fill.
- **Provide durable stop protection on its own.** Stops are emulated in this
  process. They fire only while the server runs and only when
  `indodax_stop_check` or the autopoll evaluates them. Take-profit limits rest
  on the exchange and survive an outage; stops do not. Use the exchange Deadman
  if you need protection that fails closed without this process.
- **Reconcile fully.** `indodax_reconcile_full` compares paper against live
  exchange reads, but it is not a complete exchange-state reconciliation
  workflow.

## Reading the responses

Money serializes as decimal strings. Never parse it into a float for
accounting.

Two error shapes reach a caller. Handler errors arrive as
`{status, code, message, retryable}` with `isError: true`; schema violations are
rejected by the protocol layer before any handler runs and surface as harness
text such as `Invalid arguments for tool "..."`. Branch on `code` and
`retryable`, never on message prose.

An ambiguous live result (a timeout or dropped connection after submission) is
reported as a non-retryable `UnknownExecutionResultError` carrying the client
order id. Reconcile before retrying; do not resubmit.

`indodax_docs` serves per-area agent guides at runtime, so an agent can read
the same documentation this package shipped with.

## License

SSPL-1.0. Unofficial, provided as is, with no warranty.
