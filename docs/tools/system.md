<h1 align="center">System tools</h1>

Read-only service introspection, except the always-denied withdrawal tool.
All responses are booleans, statuses, and origin names, never secrets.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_health` | `readiness`? boolean | `{ status, components (each with status, detail, wired, action, checkedAt), healthy, total, readiness?, checkedAt, summary, note }` | Complete per-component detail with wiring and next action; unwired checks explain, never bare codes. |
| `indodax_version` | none | `{ server, version, mode, protocol, transports, checkedAt, summary }` | Complete with protocol and transports. |
| `indodax_system_capabilities` | none | `{ market.read, account.read, trade.place, trade.cancel, funding.withdraw, killSwitch, circuitBreaker, allowedModes, allowedCapabilities, liveGate, summary }` | Policy view plus the live-gate breakdown. |
| `indodax_config_status` | none | `{ credentialsConfigured, mode, tradeEnabled, withdrawEnabled, mcpPort, mcpHost, rateLimitRps, stopAutopollMs, alertAutopollMs, database, durability, configSource, summary, remedy }` | Complete server configuration, never a secret. |
| `indodax_runtime_status` | none | `{ scheduler, schedulerFailures, marketSocket, privateChannel, metrics, deadman, persistence }` | Scheduler state, socket state, counters, Deadman state. |
| `indodax_funding_withdraw` | `currency`, `amount`, `address` (shape validation only) | Always `AuthorizationError` | Withdrawal has no server-side grant path by design. |
| `indodax_ws_status` | none | `{ mode, market: { state, subscriptions }, private: { state, channel } }` | Sockets are on-demand: `DISCONNECTED` is the resting state, not a failure. The private channel hash is masked. |
| `indodax_ws_ticker` | `pair` default `btc_idr` | One-shot market snapshot `{ channel, offset, data: { pair, row, rows } }` | 15s timeout. A missing pair row is an explicit `ValidationError` naming the pair instead of unrelated rows. |

## Readiness inside `indodax_health`

Pass `readiness: true` to get the readiness verdict in the same response:
`{ ready, degradedCount, degradedReasons, degradedDetail }`. It is derived
from the same two values already in the health rollup, so it is opt-in rather
than a second tool. `ready` is true only for an overall `healthy` rollup.

## What replaced the removed tools

| Removed | Now |
| --- | --- |
| retired `indodax_readiness` | `indodax_health` with `readiness: true`. |
| retired `indodax_auth_status` | `indodax_capabilities`, in `credentialsSource` (see the account tools page). |

`indodax_config_status` is unchanged and still the full configuration story:
`database` is `absent`, `connected`, or `configured_unreachable`;
`durability.state` is `unconfigured`, `connected`, or `failed`, with
`durability.stores` naming the per-store outcome (`unknown`, `connected`,
`failed`) for paper, audit, alerts, stops, and deadman. Each store keeps its own
evidence, so one store writing successfully never clears a failure belonging to
another. `configSource` records where each credential came from
(`process-env`, `repo-env-file`, `absent`) plus `repoEnvFileFound` and the names
of other variables the process received; it never contains a value.

`mcpHost` defaults to `127.0.0.1`; compose sets `MCP_HOST=0.0.0.0` so the
published host port reaches the container.

Related: `system://health`, `websocket://state`, `capabilities://matrix`
resources.