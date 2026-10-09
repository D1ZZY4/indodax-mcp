<h1 align="center">Account tools</h1>

Authenticated reads. The tools that need `INDODAX_API_KEY` plus
`INDODAX_API_SECRET` are denied by the central guard before any handler runs
when they are missing.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_account` | `zeroBalances`? boolean | `{ canTrade, canWithdraw, accountType?, balances: [{ asset, free, locked, total }], balanceCount, nonZeroBalances, assets, uid?, syncedAt }` | Full identity, permissions, and balances. `total` is Decimal `free + locked`. Replaces the former `indodax_balances`: pass `zeroBalances: false` to keep only non-zero rows, and `assets` lists what came back. |
| `indodax_capabilities` | none | `{ market.read, account.read, trade.place, trade.cancel, funding.withdraw, paper.*, mode, credentialsSource, policy, liveGate }` | `liveGate` breaks the live requirement into booleans: `satisfied`, `needsAppEnvLive`, `needsTradeEnabled`, `needsCredentials`, plus `needsAcknowledged` and `needsRiskAllow` notes. `trade.place: false` means the gate is closed, not that the tool is missing. `credentialsSource` reports where each credential came from (`process-env`, `repo-env-file`, `absent`) and never prints a value. |
| `indodax_portfolio_snapshot` | `entries`? map of ASSET to average entry price in IDR | `{ asOf, idr: { free, locked, total }, legs, totalIdr, incomplete, openOrders: { count, truncated, observedAt, orders }, stops: { open, blocked }, alerts: { active, triggered, cancelled, pairs }, deadman, notes, summary }` | One fresh picture for a monitoring loop: balances, valuation, live open orders (first 25, with `observedAt`), stop counts, alert counts, and Deadman state from reads seconds apart in a single call. Replaces account plus ticker plus orders plus stops plus alerts plus positions round-trips. Alert `triggered` and `cancelled` counts come from the full history, so a consumed trigger stays visible instead of looking like an alert that was never armed. Read-only. |
| `indodax_positions_live` | `entries`? map of ASSET to average entry price in IDR | `{ legs, positions, totalIdr, pricedLegs, totalLegs, incomplete, stopCoverage, notes }`, money as strings | Read-only, needs credentials. Every non-zero holding valued in IDR at the live last price, with its share of the portfolio and which open stops already protect that leg. `positions` aliases `legs` for harnesses that read that key. A leg with no direct pair or no usable price reports `valueIdr: null` and is listed in `incomplete`; the weights and `totalIdr` are withheld when any leg is unpriced, so a zero is never mistaken for a loss. Totals render as integer IDR; PnL keeps 2 decimals. A leg whose asset appears in `entries` also reports `entryPrice` and `unrealizedPct`; without an entry the percent stays null because the exchange states balances, not cost basis. |

## What replaced the removed tools

`indodax_auth_status` returned exactly `credentialsConfigured` plus `mode`, both
of which `indodax_capabilities` already answered. Its replacement is
`credentialsSource.credentialsPresent` for the first and the top-level `mode`
for the second. `indodax_balances` was `indodax_account` with a non-zero filter
applied, which is now the `zeroBalances: false` argument.

`indodax_capabilities` is the boolean gate view. `indodax_system_capabilities`
is the policy view (`allowedModes`, `killSwitch`); read that one for policy
detail and this one for the per-requirement checklist.

Related: `account://snapshot` resource, `indodax_capabilities` (booleans and
origin names only, never secrets).