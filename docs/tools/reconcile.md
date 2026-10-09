<h1 align="center">Reconciliation tools</h1>

Paper and exchange are separate ledgers; paper fills never settle on the
exchange. A `MISMATCH` between them means **different, not broken**. It is the
expected steady state, not an incident. Every tool here is read-only.

The surface is split in two on a real boundary, so the paper-local checks keep
working on a server with no credentials.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_reconcile_paper` | `scope` required: `state` or `orders` | depends on `scope`, see below | No credentials needed. Paper-local only. |
| `indodax_reconcile_exchange` | `scope` required: `balances`, `trades`, or `full`; `symbol`?, `tolerance`? | depends on `scope`, see below | Needs credentials. |

## `indodax_reconcile_paper`

| `scope` | Response `data` | Notes |
| --- | --- | --- |
| `state` | `{ state, checkedOrders, mismatchedOrders, openOrders, totalOrders, filledOrders, halted, checkedAt }` | Paper-ledger internal consistency (remaining inside `[0, quantity]`). A `MISMATCH` verdict is what halts trading, because risk re-derives the same check on every evaluation. This read only reports the verdict and never changes application state. |
| `orders` | `{ checked, fillable, resting, orders, pairs, checkedAt }` | Flags paper orders fillable at live prices. Every row names the compared values in `reason`; an unreadable market keeps the order open with the pair named, never a bare flag. |

## `indodax_reconcile_exchange`

| `scope` | Extra arguments | Response `data` | Notes |
| --- | --- | --- | --- |
| `balances` | `tolerance`? decimal string, default `0.01` quote-asset units | `{ balances: [{ asset, state, paper, exchange, difference }] }` | Compares paper ledger balances against live account balances. |
| `trades` | `symbol` required | `{ symbol, state, checked, mismatched, exchangeOnly, localCount, exchangeCount }` | Compares local paper fills against v2 `myTrades`. |
| `full` | `symbol`?, `tolerance`? | `{ paper, exchange: { openOrders, fills, balances, observed, observedReasons }, unknownLegs, unknownLegDetail, crossScopeNote }` | Paper-local consistency plus live exchange open orders, fills, and balances in one report. |

Each `openOrders` row carries the real `side`, `price`, `quantity`, `symbol`,
`clientOrderId`, and exchange state exactly as the exchange reports them, never
inferred, so a summary built from this cannot invent a direction. Exchange legs
that fail to read land in `unknownLegs` with per-leg reasons instead of failing
the report.

## Why these are two tools and not one

Five reconciliation reads collapsed into two. The paper-local checks run
entirely on the in-memory ledger and must keep working without credentials; the
exchange-backed ones all need the authenticated client. A single tool would
force one `authRequirement`, which either denies the paper paths on an
uncredentialed server or drops `credentials` from the metadata and moves the
gate out of the central guard into the handler. One slot of tool context is not
worth weakening the guard.

## What replaced the removed tools

| Removed | Now |
| --- | --- |
| retired `indodax_reconciliation_state` | `indodax_reconcile_paper` with `scope: "state"` |
| retired `indodax_reconcile_orders` | `indodax_reconcile_paper` with `scope: "orders"` |
| retired `indodax_reconcile_balances` | `indodax_reconcile_exchange` with `scope: "balances"` |
| retired `indodax_reconcile_trades` | `indodax_reconcile_exchange` with `scope: "trades"` |
| retired `indodax_reconcile_full` | `indodax_reconcile_exchange` with `scope: "full"` |

On any ambiguous live outcome: preserve the client order id, treat the result as
unknown, reconcile before any resubmission, and never retry blindly.

Related: `reconciliation://state` resource, `docs/architecture/execution.md`.