<h1 align="center">Alert tools</h1>

Server-local price alerts (memory-first, Postgres mirror when configured).
The exchange exposes no alert API, so everything here is evaluated locally
against live public prices.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_alerts` | `history` boolean optional | Active alerts, or all states with history | — |
| `indodax_alert_create` | `pair`, exactly one of `above`, `below`, `percentUp`, `percentDown` (positive numbers), `note`? | `{ id, status }` | Percent modes anchor to the live price at creation. Anything else is a `ValidationError`. |
| `indodax_alert_cancel` | `id` | `{ id, status: "cancelled" }` | Only active alerts cancel. |
| `indodax_alert_check` | `pair` | `{ pair, price, triggered }` | Manual evaluation; no mutation when nothing triggers. |

Automatic push (no harness loop needed):

- Set `ALERT_AUTOPOLL_MS` to evaluate all active alerts on an interval.
  One ticker read per pair per round.
- Every trigger pushes an MCP `notifications/message` (level `notice`,
  `{ alert, pair, event: "triggered" }`) to connected clients that listen,
  plus a `notifications/resources/updated` for `alerts://active`.
- Clients that do not listen simply never see the push; the trigger itself
  still applies. Delivery beyond MCP (e.g. phone notifications) is not
  part of this server.

Related: `alerts://active` resource, stop tools (same autopoll pattern).
