<h1 align="center">Reconciliation tools</h1>

Paper and exchange are separate ledgers; paper fills never settle on the
exchange. A `MISMATCH` between them means **different, not broken**. It is
the expected steady state, not an incident. Only the paper-local
`indodax_reconciliation_state` can halt trading, and it reports `MATCH` on an
empty ledger too. Every tool here is read-only.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_reconcile_balances` | `tolerance` decimal string optional, default `0.01` (quote-asset units) | `{ balances: [{ asset, state }] }` | Needs credentials. |
| `indodax_reconcile_orders` | none | `{ checked, orders: [{ orderId, state, side, limit, market, fillable, reason }] }` | Paper-local: flags paper orders fillable at live prices. Every row names the compared values in `reason`; an unreadable market keeps the order open with the pair named, never a bare flag. No mutation. |
| `indodax_reconciliation_state` | none | `{ state, checkedOrders, mismatchedOrders, halted }` | Paper-local consistency (remaining within `[0, quantity]`). A `MISMATCH` verdict is what halts placement, because risk re-derives the same check on every evaluation. This tool only reports the verdict and never changes application state. |
| `indodax_reconcile_full` | `symbol`?, `tolerance`? | `{ paper, exchange: { openOrders, fills, balances, observed, observedReasons }, unknownLegs, unknownLegDetail, crossScopeNote }` | Needs credentials. Exchange legs that fail to read land in `unknownLegs` with per-leg reasons instead of failing the report. Read-only: the cross-ledger comparison never halts paper trading. |
| `indodax_reconcile_trades` | `symbol` | `{ symbol, state, checked, mismatched, exchangeOnly }` | Needs credentials. Compares local paper fills against v2 `myTrades`. |

On any ambiguous live outcome: preserve the client order id, treat the
result as unknown, reconcile before any resubmission, and never retry blindly.

Related: `reconciliation://state` resource, `docs/architecture/execution.md`.
