<h1 align="center">Account tools</h1>

Authenticated reads. All three account tools need `INDODAX_API_KEY` plus
`INDODAX_API_SECRET`; without them the central guard denies the call before
any handler runs.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_account` | none | `{ canTrade, canWithdraw, accountType?, balances: [{ asset, free, locked }], uid? }` | Full identity, permissions, and balances. |
| `indodax_balances` | none | Non-zero balances as `[{ asset, free, locked, total }]` | `total` is Decimal `free + locked`. |
| `indodax_capabilities` | none | `{ market.read, account.read, trade.place, trade.cancel, funding.withdraw, paper.*, mode, liveGate }` | `liveGate` breaks the live requirement into booleans: `satisfied`, `needsAppEnvLive`, `needsTradeEnabled`, `needsCredentials`, plus `needsAcknowledged` and `needsRiskAllow` notes. `trade.place: false` means the gate is closed, not that the tool is missing. |
| `indodax_positions_live` | `entries`? map of ASSET to average entry price in IDR | `{ legs, totalIdr, pricedLegs, totalLegs, incomplete, stopCoverage, notes }`, money as strings | Read-only, needs credentials. Every non-zero holding valued in IDR at the live last price, with its share of the portfolio and which open stops already protect that leg. A leg with no direct pair or no usable price reports `valueIdr: null` and is listed in `incomplete`; the weights and `totalIdr` are withheld when any leg is unpriced, so a zero is never mistaken for a loss. A leg whose asset appears in `entries` also reports `entryPrice` and `unrealizedPct`; without an entry the percent stays null because the exchange states balances, not cost basis. |

`indodax_capabilities` is the boolean gate view. `indodax_system_capabilities`
is the policy view (`allowedModes`, `killSwitch`); read that one for policy
detail and this one for the per-requirement checklist.

Related: `account://snapshot` resource, `indodax_auth_status` (booleans only,
never secrets).
