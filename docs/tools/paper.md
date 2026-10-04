<h1 align="center">Paper tools</h1>

Simulation only. Paper orders never reach INDODAX. The ledger starts with
100,000,000 IDR and 1 BTC. Only LIMIT orders are supported in simulation;
MARKET is rejected with an explicit message.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_paper_account` | none | Balances map | — |
| `indodax_paper_status` | none | `{ tradeCount, openOrders, totalFees }` | — |
| `indodax_paper_orders` | none | Open paper orders | ACCEPTED and PARTIALLY_FILLED. |
| `indodax_paper_snapshots` | none | Full ledger (balances, orders, cost basis, realized PnL, replay log) | Includes `initialBalances` for reconciliation. |
| `indodax_paper_fills` | none | FILLED paper orders | Registered under history tools. |
| `indodax_paper_order` | `pair`, `side`, `price` positive, `quantity` positive, `clientOrderId` optional | Paper `ExecutionResult` | Full validation plus risk review. Repeated `clientOrderId` replays (max 100 remembered). Deadman STALE/EXPIRED halts even paper. |
| `indodax_paper_fill` | `orderId`, `price` positive | `{ orderId, status: "filled", fee }` | Fee uses the paper taker rate; BUY fills add average-cost basis, SELL fills realize PnL. |
| `indodax_paper_cancel` | `orderId` (any id form) | `{ orderId, status: "cancelled" }` | Refunds reserved quote/base. |
| `indodax_paper_reset` | `acknowledged: true` required | `{ status: "reset", cleared: { tradeCount, openOrders, totalFees } }` | Destructive to simulation only. Writes a `PaperReset` audit entry. |

Money serializes as strings. With `DATABASE_URL` set, mutations mirror to
Postgres and the latest snapshot reloads on boot.

Related: order tools (shared pipeline), portfolio tools (valuation), risk
tools, `portfolio://state` resource.
