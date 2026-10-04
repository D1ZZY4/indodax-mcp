<h1 align="center">Stop tools</h1>

Server-side emulated stops: the exchange has no native stop orders, so the
server watches live prices and executes crossed stops as plain LIMIT orders
through the normal risk-guarded path. Stops only fire while this server runs;
use `STOP_AUTOPOLL_MS` or call `indodax_stop_check` on a schedule.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_stop_create` | `pair`, `side` (SELL triggers at/below, BUY at/above), `quantity` positive, `stopPrice` positive, `limitPrice`? default stopPrice, `mode` paper/live?, `acknowledged`?, `clientOrderId`?, `timeInForce` GTC/MOC?, `stpMode`? | `{ id, status: "open" }` | Notional is pre-checked against risk limits at creation, so an undersized stop is rejected immediately instead of failing later at trigger time. Live creation needs the full live gate and records `acknowledgedAt`. |
| `indodax_stops` | `history`? | Open stops, or all states with history | — |
| `indodax_stop_cancel` | `id` | `{ id, status: "cancelled" }` | Only open stops cancel. |
| `indodax_stop_check` | none | `{ checked, fired: [{ id, status, price?, reason? }] }` | Crossed stops place LIMIT orders (paper fills nothing by itself; follow with `indodax_paper_fill`). Failed placements mark the stop `failed` with the reason. |

A SELL stop fires when `last <= stopPrice`, a BUY stop when
`last >= stopPrice`, compared with Decimal precision.

Related: order tools, paper tools, alert tools (same autopoll pattern).
