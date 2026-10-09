<h1 align="center">Paper tools</h1>

Simulation only. Paper orders never reach INDODAX. The ledger starts with
100,000,000 IDR and 1 BTC. LIMIT is the default; MARKET fills instantly at
the current live price (quantity stays in base units, unlike live BUY MARKET
which uses quote quantity) and needs market reachability. Offline, it is
rejected with an explicit message.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_paper_ledger` | `view`? `status`, `account`, `orders`, `snapshots`; default `status` | every view returns `{ view, tradeCount, openOrders, openOrderIds, openOrdersTruncated, filledOrders, totalFees, balances, realizedByDay, pairs, ledger }` plus view-specific fields | The complete virtual ledger, never real money. |
| `indodax_paper_order` | `pair`, `side`, `quantity` positive base units, `price`? (LIMIT only), `orderType`? LIMIT/MARKET, `clientOrderId`? | Paper `ExecutionResult` plus `{ pair, side, mode, summary, note, orderType }`; MARKET returns fill details at once | Full validation plus risk review. `orderType` echoes the requested type in the response **and** in the stored ledger record, so a MARKET request is never reported back as LIMIT. Repeated `clientOrderId` replays (max 100 remembered). Deadman STALE/EXPIRED halts even paper. Quantity is pre-checked against the pair increment with a rounded suggestion. |
| `indodax_paper_fill` | `orderId`, `price` positive | `{ orderId, status: "filled", fee, feeRate, fillPrice, filledQuantity, filledOrder, state, balances, totalFees, tradeCount, completedStops, summary, note }` | Complete with order, fees, and ledger totals. Filling a take-profit leg whose client id ends in `-takeProfit` cancels the sibling stop in the same OCO group. |
| `indodax_paper_cancel` | `orderId` (any id form) | `{ orderId, status: "cancelled", balances, openOrders, tradeCount, summary, note }` | Complete with remaining counts. |
| `indodax_paper_reset` | `acknowledged: true` required | `{ status: "reset", cleared: { tradeCount, openOrders, totalFees } }` | Destructive to simulation only. Writes a `PaperReset` audit entry. |

## Views

The ledger has four shapes because the four removed reads were field selections
over the same snapshot. Every view also returns the raw ledger under `ledger`,
so no view has to be guessed to reach a field.

| `view` | Adds | Use it for |
| --- | --- | --- |
| `status` | `initialBalances` | The monitoring default: counts, balances, realized PnL today. |
| `account` | `initialBalances`, `costBasisAssets` | The full virtual account including which assets carry a tracked cost basis. |
| `orders` | `count`, `orders`, `sides` | The open paper order records themselves. |
| `snapshots` | `summary` with asset and order counts | The raw ledger plus counts, for a state dump. |

## What replaced the removed tools

`indodax_paper_status`, `indodax_paper_account`, `indodax_paper_orders`, and
`indodax_paper_snapshots` became the `view` argument on
`indodax_paper_ledger`. `indodax_paper_snapshots` already returned the complete
ledger object, so the other three were strict subsets of it.

Money serializes as strings. With `DATABASE_URL` set, mutations mirror to
Postgres and the latest snapshot reloads on boot.

Related: order tools (shared pipeline), portfolio tools (valuation), risk
tools, `portfolio://state` resource.