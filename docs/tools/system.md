<h1 align="center">System tools</h1>

Read-only service introspection, except the always-denied withdrawal tool.
All responses are booleans and statuses, never secrets.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_health` | none | `{ status, components }` (database, exchangeRest, exchangeWs, mcpTransport, scheduler, queue, deadman, configuration, runtime) | `unknown` means the check is not wired, not that it failed. |
| `indodax_readiness` | none | `{ ready, status, degradedReasons }` | `ready` is true only for overall `healthy`; every non-healthy component is named. |
| `indodax_version` | none | `{ server, version, mode }` | — |
| `indodax_system_capabilities` | none | Policy view (`market.read`, `account.read`, killSwitch, allowedModes) | Policy-level; for the per-requirement live checklist use `indodax_capabilities`. |
| `indodax_config_status` | none | `{ credentialsConfigured, mode, tradeEnabled, withdrawEnabled: false }` | — |
| `indodax_runtime_status` | none | `{ scheduler, schedulerFailures, marketSocket, privateChannel, metrics, deadman }` | — |
| `indodax_auth_status` | none | `{ credentialsConfigured, mode }` | Credential presence only. |
| `indodax_funding_withdraw` | `currency`, `amount`, `address` (shape validation only) | Always `AuthorizationError` | Withdrawal has no server-side grant path by design. |
| `indodax_ws_status` | none | `{ market: { state, subscriptions }, private: { state, channel } }` | Honest connection states; no fake LIVE. |
| `indodax_ws_ticker` | `pair` default `btc_idr` | One-shot market snapshot `{ channel, offset, data: { pair, row, rows } }` | 15s timeout. A missing pair row is an explicit `ValidationError` naming the pair (use REST `indodax_ticker` for it) instead of unrelated rows. |

Related: `system://health`, `websocket://state`, `capabilities://matrix` resources.
