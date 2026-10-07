<h1 align="center">Stop tools</h1>

Server-side emulated stops: the exchange has no native stop orders, so the
server watches live prices and executes crossed stops as plain LIMIT orders
through the normal risk-guarded path. Stops only fire while this server runs;
use `STOP_AUTOPOLL_MS` or call `indodax_stop_check` on a schedule.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_stop_create` | `pair`, `side` (SELL triggers at/below, BUY at/above), `quantity` positive, exactly one of `stopPrice` positive or `percentDown` (SELL) or `percentUp` (BUY) anchored to the live price, `limitPrice`? default the trigger, `mode` paper/live?, `acknowledged`?, `clientOrderId`?, `timeInForce` GTC/MOC?, `stpMode`?, `groupId`? OCO link | `{ id, status, liquidity?, warning?, remedy? }` | Notional is pre-checked against risk limits at creation, so an undersized stop is rejected immediately instead of failing later at trigger time. A stop below the minimum fails with `UNDERMINIMUM_STOP` carrying the shortfall and the minimum viable quantity; size the position up front or monitor with alerts. Live creation needs the full live gate and records `acknowledgedAt`. A live stop also checks the asset is actually free: a resting take-profit reserves the quantity it will sell, so a cut-loss on that same quantity would be refused with `-2010` when it triggers. The stop is still created, but the response carries `warning`, `liquidity`, and `remedy` naming the order holding the quantity. |
| `indodax_stops` | `history`? | `{ count, open, blocked, stops, blockedStops?, note? }` | `blocked` counts armed stops whose placement was refused; they stay active and retry automatically on every check and autopoll pass. A blocked stop is not the same as an open one, so it is never folded into the `open` count. History rows for fired stops carry `triggeredPrice` (market last at the crossing) next to the `stopPrice` setting, so trigger-vs-market slippage audits without a second query; compare with the later fill record for fill slippage. |
| `indodax_stop_cancel` | `id` | `{ id, status: "cancelled" }` | Open and blocked stops both cancel. |
| `indodax_stop_check` | none | `{ checked, fired: [{ id, status, price?, triggerPrice?, limitPrice?, reason?, retryable?, fix?, cancelledSiblings?, cancelledLinkedOrders? }], openStops, totalStops, retryable, retryableStops, blocked, blockedStops, protectionIntact, summary }` | Crossed stops place LIMIT orders (paper fills nothing by itself; follow with `indodax_paper_fill`). `checked` counts the **stops examined on this pass**, not the lifetime history, so a cancelled or already-triggered stop never inflates it. Live stops refresh the account first, so an autopoll-only setup no longer dies on `STALE_ACCOUNT_STATE`. Three outcomes are distinguished: `triggered`, `blocked` (the quantity is reserved by another order, so the stop stays armed and retries, with `blockedStops` naming the fix), and `failed` (a terminal refusal such as a minimum-size violation). A fired stop auto-cancels open siblings in its OCO group and cancels its linked take-profit first, so the quantity is free when the stop places. |
| `indodax_stop_retry` | `id` required | `{ id, status, result, checked, openStops, summary }` | Re-arms one blocked stop and re-evaluates it immediately instead of waiting for the next check or autopoll. Refuses with guidance when the stop is not blocked. |

A SELL stop fires when `last <= stopPrice`, a BUY stop when
`last >= stopPrice`, compared with Decimal precision.

## A stop and a take-profit compete for the same balance

The exchange reserves balance per open order. A resting take-profit SELL holds
the quantity it will sell, so a cut-loss SELL on that same quantity is refused
with `-2010 insufficient balance` the moment it triggers. The stop is still
armed, but it cannot place while the take-profit rests. `indodax_stop_create`
detects this before arming and the response carries `warning`, `liquidity`, and
`remedy` naming the order that holds the quantity.

Two ways to make the pair work:

1. `indodax_oco_bundle` places both legs and links them, so the trigger cancels
   the take-profit first.
2. `indodax_oco_attach` links a cut-loss to a take-profit that **already rests**
   on the exchange. Use it for positions opened before `indodax_oco_bundle`.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_oco_attach` | `orderId` required (exchange order id, full order id, or clientOrderId of the resting take-profit), `stopPrice` required, `limitPrice`? default stopPrice, `pair`? to narrow the lookup, `quantity`? default the resting amount, `side`? default the order's own side, `groupId`?, `clientOrderId`?, `acknowledged: true` required | `{ id, status, linkedOrderId, linkedClientOrderId, restingOrderPrice, liquidity?, remedy?, marketNote?, summary, note }` | Places nothing and cancels nothing: it records the link. The resting quantity is read from the exchange rather than taken from the caller's arguments, and attaching a second stop to the same order is refused rather than duplicated. A stop that already arms the same pair, side, and quantity is likewise refused with `DUPLICATE_STOP` naming the armed stop, so one position never carries two cut-losses by accident. If the market already sits at the trigger, `marketNote` says so, because a cut-loss above the market fires immediately. |

## OCO groups (TP plus cut-loss together)

Two stops sharing a `groupId` behave as one-cancels-the-other: whichever fires
first executes through the normal risk-guarded path while the sibling is
cancelled with reason `oco-cancelled by <stop-id>`. Stops without a `groupId`
behave exactly as before.

Creating a stop reserves nothing, so two stops in a group can coexist on the
same balance; only the fired leg places an order. A **take-profit order** is
different: it does reserve, which is why `groupId` alone is not enough and
`indodax_oco_attach` exists.

Related: order tools, paper tools, alert tools (same autopoll pattern).
