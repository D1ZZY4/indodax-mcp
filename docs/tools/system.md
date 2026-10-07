<h1 align="center">System tools</h1>

Read-only service introspection, except the always-denied withdrawal tool.
All responses are booleans and statuses, never secrets.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_health` | none | `{ status, components (each with status, detail, wired, action, checkedAt), healthy, total, summary, note }` | Complete per-component detail with wiring and next action; unwired checks explain, never bare codes. |
| `indodax_readiness` | none | `{ ready, status, degradedCount, degradedReasons, degradedDetail (component, status, detail, action), summary }` | Complete with counts and per-component actions. |
| `indodax_version` | none | `{ server, version, mode, protocol, transports, summary }` | Complete with protocol and transports. |
| `indodax_system_capabilities` | none | Policy view plus `circuitBreaker, allowedCapabilities, liveGate { appEnvLive, tradeEnabled, credentials, policyAllowsLive }, summary` | Complete policy plus live-gate breakdown. |
| `indodax_config_status` | none | `{ credentialsConfigured, mode, tradeEnabled, withdrawEnabled: false, mcpPort, mcpHost, rateLimitRps, stopAutopollMs, alertAutopollMs, database, durability, configSource, summary, remedy }` | Complete server configuration. `mcpHost` defaults to `127.0.0.1`; compose sets `MCP_HOST=0.0.0.0` so the published host port reaches the container. `database` is `absent`, `connected`, or `configured_unreachable`. `durability.state` is `unconfigured`, `connected`, or `failed`, with `durability.stores` naming the per-store outcome (`unknown`, `connected`, `failed`) for paper, audit, alerts, stops, and deadman. Each store keeps its own evidence, so one store writing successfully never clears a failure belonging to another: a stops mirror that has not attached is still reported as failed. `configSource` records where each credential actually came from (`process-env`, `repo-env-file`, `absent`) plus `repoEnvFileFound` and the names of other variables the process received; it never contains a value. `remedy` states the actionable next step, for example that the process received no credentials at all. |
| `indodax_runtime_status` | none | `{ scheduler, schedulerFailures, marketSocket, privateChannel, metrics, deadman, persistence }` | `persistence` reports `database: configured/absent` plus which stores mirror; memory-only mode loses paper, audit, alerts, stops, and deadman on restart. |
| `indodax_auth_status` | none | `{ credentialsConfigured, mode }` | Credential presence only. |
| `indodax_funding_withdraw` | `currency`, `amount`, `address` (shape validation only) | Always `AuthorizationError` | Withdrawal has no server-side grant path by design. |
| `indodax_ws_status` | none | `{ mode, market: { state, subscriptions }, private: { state, channel } }` | Sockets are on-demand: `DISCONNECTED` is the resting state, not a failure. Honest connection states; no fake LIVE. |
| `indodax_ws_ticker` | `pair` default `btc_idr` | One-shot market snapshot `{ channel, offset, data: { pair, row, rows } }` | 15s timeout. A missing pair row is an explicit `ValidationError` naming the pair (use REST `indodax_ticker` for it) instead of unrelated rows. |

Related: `system://health`, `websocket://state`, `capabilities://matrix` resources.
