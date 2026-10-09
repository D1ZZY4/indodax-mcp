<h1 align="center">Portfolio tools</h1>

Read-only paper valuation at live market prices. Assets that cannot be priced
live are reported in `incomplete` and contribute nothing instead of a guess.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_portfolio` | `view`? `summary`, `positions`, `pnl`; default `summary` | every view returns `{ view, balances, positions, incomplete, prices, tradeCount, totalFees }` plus view-specific fields | Paper holdings valued at live prices. |
| `indodax_exposure` | none | `{ count, exposure: [{ asset, amount, valueIdr, price }], totalIdr, incomplete }` | Per-asset exposure. Registered under ops tools. |

## Views

| `view` | Adds | Use it for |
| --- | --- | --- |
| `summary` | `initialBalances`, `equityIdr`, `positionCount`, `pnlIdr` | The default: total portfolio value in IDR. |
| `positions` | `count` | One row per asset with `current`, `initial`, per-asset `pnl`, and `valueIdr`. |
| `pnl` | `pnlIdr`, `equityIdr`, `valuedAssets`, `totalAssets` | Total profit and loss in IDR, and how many assets could be priced. |

Every view already includes `positions`, `incomplete`, and `prices`, so no
shape has to be chosen to reach a field. An unpriced asset appears in
`incomplete` and is excluded from every total rather than valued at zero.

## What replaced the removed tools

`indodax_positions` and `indodax_pnl` became the `view` argument. All three
reads called the same helper over the same paper snapshot, and the PnL total
was already derivable from the per-asset rows, so the merge removed duplicate
work rather than information.

Totals render as integer IDR, since IDR has no fractional unit; PnL keeps two
decimals. Related: paper tools (ledger), `portfolio://state` resource.