<h1 align="center">Account tools</h1>

Authenticated reads. All three account tools need `INDODAX_API_KEY` plus
`INDODAX_API_SECRET`; without them the central guard denies the call before
any handler runs.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_account` | none | `{ canTrade, canWithdraw, accountType?, balances: [{ asset, free, locked }], uid? }` | Full identity, permissions, and balances. |
| `indodax_balances` | none | Non-zero balances as `[{ asset, free, locked, total }]` | `total` is Decimal `free + locked`. |
| `indodax_capabilities` | none | `{ market.read, account.read, trade.place, trade.cancel, funding.withdraw, paper.*, mode, liveGate }` | `liveGate` breaks the live requirement into booleans: `satisfied`, `needsAppEnvLive`, `needsTradeEnabled`, `needsCredentials`, plus `needsAcknowledged` and `needsRiskAllow` notes. `trade.place: false` means the gate is closed, not that the tool is missing. |

`indodax_capabilities` is the boolean gate view. `indodax_system_capabilities`
is the policy view (`allowedModes`, `killSwitch`); read that one for policy
detail and this one for the per-requirement checklist.

Related: `account://snapshot` resource, `indodax_auth_status` (booleans only,
never secrets).
