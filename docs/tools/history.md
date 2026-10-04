<h1 align="center">History tools</h1>

Authenticated live reads plus local paper fills. History limits are 10-1000
per the exchange contract.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_open_orders` | `symbol`? (uppercase compact, e.g. `BTCIDR`) | Live open orders array | Needs credentials. |
| `indodax_order` | `symbol` required, `orderId`? or `clientOrderId`? | One live order | Needs credentials. Numeric exchange id vs full client id: at least one required. |
| `indodax_order_history` | `symbol` required, `limit` 10-1000 default 100, `startTime`/`endTime` ms optional (max 7-day range) | `{ data: [...] }` with `oriQty`, `submitTime`/`finishTime`, optional `cancelReason: SELF_TRADE_PREVENTION` | Needs credentials. Legacy v1 history is decommissioned; this is the v2 path. |
| `indodax_trade_history` | Same shape as order history | `{ data: [{ tradeId, orderId (full id), clientOrderId, symbol, price, qty, quoteQty, commission, commissionAsset, isBuyer, isMaker, time }] }` | Needs credentials. `orderId` here is the full id (`aaveidr-limit-3568`), unlike the numeric id on `indodax_order`. |
| `indodax_paper_fills` | none | FILLED paper orders from local simulation | No credentials. Paper fills never settle on the exchange. |

Related: funding tools, reconcile tools, `orders://open` resource.
