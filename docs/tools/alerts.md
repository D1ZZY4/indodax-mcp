<h1 align="center">Alert tools</h1>

Server-local price alerts (memory-first, Postgres mirror when configured).
The exchange exposes no alert API, so everything here is evaluated locally
against live public prices.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_alerts` | `history` boolean optional | `{ count, active, triggered, cancelled, alerts, pairs, summary, note }`; active alerts, or every state with `history: true` | Use `history: true` to see alerts that already triggered, since a consumed alert no longer appears in the active list. |
| `indodax_alert_create` | `pair`, exactly one of `above`, `below`, `percentUp`, `percentDown` (positive numbers), `note`? | `{ id, status }` | The condition is the flat field itself, not a nested object: `{ pair: "ton_idr", below: 24763.44548379 }`. Percent modes anchor to the live price at creation. Anything else is a `ValidationError`. |
| `indodax_alert_cancel` | `id` | `{ id, status: "cancelled" }` | Only active alerts cancel. |
| `indodax_alert_check` | `pair` | `{ pair, price, priceSource, priceAgeMs, priceStale, count, triggered, triggeredCount, alreadyTriggered, alreadyTriggeredCount, remainingActive, summary, note }` | Manual evaluation; no mutation when nothing triggers. `priceSource` is `live` or `cache`, so a repeated call inside the cache window is visible. `triggeredCount` counts only alerts this call retired: `alreadyTriggered` lists alerts already retired as triggered, which is how a trigger consumed by the scheduled autopoll is still observable. Treat `triggeredCount: 0` with a non-empty `alreadyTriggered` as "already fired", not "never fired". |

Automatic push (no harness loop needed):

- Set `ALERT_AUTOPOLL_MS` to evaluate all active alerts on an interval.
  One ticker read per pair per round, served from the shared 30s cache, so a
  round can repeat the same price until the cache row expires.
- Every trigger pushes an MCP `notifications/message` (level `notice`,
  `{ alert, pair, event: "triggered" }`) to connected clients that listen,
  plus a `notifications/resources/updated` for `alerts://active`.
- Clients that do not listen simply never see the push; the trigger itself
  still applies. Delivery beyond MCP (e.g. phone notifications) is not
  part of this server.

## Autopoll and an agent check share one store

The autopoll and `indodax_alert_check` both evaluate the same alerts against
the same `AlertStore`, and whichever runs first retires a matching alert. An
autopoll round that fires an alert before the agent's own check therefore
leaves that check with nothing active to transition. `alreadyTriggered`
closes that gap: read it whenever `triggeredCount` is 0, and treat a non-empty
result as "already fired", not "never fired". Cross-check `indodax_alerts` with
`history: true` for the same reason.

Related: `alerts://active` resource, stop tools (same autopoll pattern).
