<h1 align="center">Reconciliation tools</h1>

Paper and exchange are separate ledgers; paper fills never settle on the
exchange. A `MISMATCH` between them is observational truth, not a bug. Every
tool here is read-only.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_reconcile_balances` | `tolerance` decimal string optional, default `0.01` (quote-asset units) | `{ balances: [{ asset, state }] }` | Needs credentials. |
| `indodax_reconcile_orders` | none | `{ checked, orders: [{ orderId, state, limit, market, fillable }] }` | Paper-local: flags paper orders fillable at live prices. No mutation. |
| `indodax_reconciliation_state` | none | `{ state, checkedOrders, mismatchedOrders }` | Paper-local consistency (remaining within `[0, quantity]`). `MISMATCH` halts further placement via risk. |
| `indodax_reconcile_full` | `symbol`?, `tolerance`? | `{ paper, exchange: { openOrders, fills, balances, observed }, unknownLegs, crossScopeNote }` | Needs credentials. Exchange legs that fail to read land in `unknownLegs` instead of failing the report. Never halts paper trading. |
| `indodax_reconcile_trades` | `symbol` | `{ symbol, state, checked, mismatched, exchangeOnly }` | Needs credentials. Compares local paper fills against v2 `myTrades`. |

On any ambiguous live outcome: preserve the client order id, treat the
result as unknown, reconcile before any resubmission, and never retry blindly.

Related: `reconciliation://state` resource, `docs/architecture/execution.md`.
