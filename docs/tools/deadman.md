<h1 align="center">Deadman tools</h1>

Two separate safety layers share one state machine (`DISARMED`, `ARMED`,
`STALE`, `EXPIRED`):

1. **Local switch** - halts placement through risk when heartbeats go stale.
   `DISARMED` is an explicit opt-out and never blocks.
2. **Exchange countdown** (`POST /tapi countdownCancelAll`) - the exchange
   cancels the pairs' open orders if no heartbeat arrives within the window.
   Countdown `0` stops the exchange timer.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_deadman_arm` | `pairs` non-empty, `countdownMs` positive | Status snapshot | Local only. |
| `indodax_deadman_status` | none | `{ state, pairs, countdownMs, countdownHuman, lastRefreshAt, consecutiveFailures, exchange }` | `countdownHuman` renders `24h`/`90s` style alongside ms. `exchange` reports whether the exchange countdown endpoint is reachable (`available`, `lastError`, `observedAt`); an ARMED local switch with an unreachable exchange is not protection. |
| `indodax_deadman_disarm` | `acknowledged: true` required | Status snapshot | Disarming removes heartbeat protection globally; hence the gate. With `DATABASE_URL` set, arm/disarm/heartbeat mirror to Postgres and survive restarts. |
| `indodax_deadman_heartbeat` | `countdownMs` non-negative, `pairs`? (default armed pairs), `acknowledged: true` required | `{ pairs, countdownMs, state }` | Live exchange call: needs the full live gate (APP_ENV, TRADE_ENABLED, credentials). Success records a local refresh; a transient failure records a refresh failure (3 consecutive = EXPIRED). A refusal the key can never satisfy (access denied, unauthorized IP) does not advance the counter; it fails loudly and marks the exchange unreachable instead. |

Heartbeat cadence tip: refresh well inside the window (e.g. every 30s for a
120s countdown). The 24-hour private-token lifecycle is a separate concern;
see the private channel guide.

Related: risk tools (Deadman verdicts), `risk://state` resource.
