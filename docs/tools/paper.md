<h1 align="center">Paper tools</h1>

Simulation only. Paper orders never reach INDODAX. The ledger starts with
100,000,000 IDR and 1 BTC. LIMIT is the default; MARKET fills instantly at
the current live price (quantity stays in base units, unlike live BUY MARKET
which uses quote quantity) and needs market reachability. Offline, it is
rejected with an explicit message.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_paper_account` | none | `{ balances, initialBalances, tradeCount, openOrders, openOrderIds, totalFees, realizedByDay, costBasisAssets, summary, note }` | Complete account, not just balances. |
| `indodax_paper_status` | none | `{ tradeCount, openOrders, openOrderIds (first 100), openOrdersTruncated, totalFees, filledOrders, balances, initialBalances, realizedByDay, pairs, summary, note }` | Complete status with balances and pairs. |
| `indodax_paper_orders` | none | `{ count, orders (full records), pairs, sides, summary, note }` | Complete with count and summary. |
| `indodax_paper_snapshots` | none | Full ledger plus `{ summary: { assets, totalOrders, openOrders, filledOrders, tradeCount, totalFees } }` | Complete with summary counts. |
| `indodax_paper_fills` | none | `{ count, fills (full records), pairs, summary, note }` | Registered under history tools. Complete with count. |
| `indodax_paper_order` | `pair`, `side`, `quantity` positive base units, `price`? (LIMIT only), `orderType`? LIMIT/MARKET, `clientOrderId`? | Paper `ExecutionResult` plus `{ pair, side, mode, summary, note, orderType }`; MARKET returns fill details at once | Full validation plus risk review. `orderType` echoes the requested type in the response **and** in the stored ledger record, so a MARKET request is never reported back as LIMIT. Repeated `clientOrderId` replays (max 100 remembered). Deadman STALE/EXPIRED halts even paper. Quantity is pre-checked against the pair increment with a rounded suggestion. |
| `indodax_paper_fill` | `orderId`, `price` positive | `{ orderId, status: "filled", fee, feeRate, fillPrice, filledQuantity, filledOrder, state, balances, totalFees, tradeCount, summary, note }` | Complete with order, fees, and ledger totals. |
| `indodax_paper_cancel` | `orderId` (any id form) | `{ orderId, status: "cancelled", balances, openOrders, tradeCount, summary, note }` | Complete with remaining counts. |
| `indodax_paper_reset` | `acknowledged: true` required | `{ status: "reset", cleared: { tradeCount, openOrders, totalFees } }` | Destructive to simulation only. Writes a `PaperReset` audit entry. |

Money serializes as strings. With `DATABASE_URL` set, mutations mirror to
Postgres and the latest snapshot reloads on boot.

Related: order tools (shared pipeline), portfolio tools (valuation), risk
tools, `portfolio://state` resource.
