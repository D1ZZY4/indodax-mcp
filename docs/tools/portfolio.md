<h1 align="center">Portfolio tools</h1>

Read-only paper valuation at live market prices. Assets that cannot be priced
live are reported in `incomplete` and contribute nothing instead of a guess.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_portfolio` | none | `{ balances, equityIdr, positions, prices, incomplete }`, money as strings | `equityIdr` sums IDR plus holdings valued at live prices. |
| `indodax_positions` | none | `{ positions: [{ asset, current, initial, pnl, valueIdr }], incomplete }` | `pnl` is quantity delta vs initial balances, `valueIdr` may be `null` when unpriced. |
| `indodax_pnl` | none | `{ tradeCount, totalFees, pnlIdr, valuedAssets, incomplete }` | Quantity deltas converted at live prices; unpriced assets skipped. |
| `indodax_exposure` | none | `{ exposure: [{ asset, amount, valueIdr }], totalIdr, incomplete }` | `totalIdr` sums priced rows only. Registered under ops tools. |

Related: paper tools (ledger), `portfolio://state` resource.
