<h1 align="center">Funding tools</h1>

Authenticated read-only funding information. Withdrawal mutations are always
denied (see system tools); this page only reads history, addresses, and fees.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_funding` | `kind` required, plus per-kind arguments | depends on `kind`, see below | Needs credentials. Every read the server exposes for funding. |

## Kinds

| `kind` | Extra arguments | Response `data` | Notes |
| --- | --- | --- | --- |
| `withdrawHistory` | `coin`? crypto only, default BTC, max 90 days | `{ kind, coin, count, history }` with rows `{ id, amount, transactionFee, coin, address, txId, network, status, applyTime, completeTime }` | `coin: IDR` is rejected up front with a pointer to the `fiatHistory` kind. |
| `depositHistory` | `coin`? crypto only, same defaults | `{ kind, coin, count, history }` with `insertTime`/`completeTime` | Same IDR rule as above. |
| `fiatHistory` | none, max 30 days | `{ kind, count, history }` where `history` is `{ data: [...] }` | The IDR path. Rows carry `orderNo`, `amount`, `totalFee`, `method`, `fiatCurrency`, `status`, timestamps, and bank detail. |
| `depositAddress` | `coin` required crypto, `network` required | `{ kind, coin, network, count, addresses, permitted: true }` | Empty addresses with `permitted: true` means no address was generated yet, not a permission failure. A grant refusal fails instead as `FUNDING_UNAUTHORIZED`. |
| `withdrawFee` | `currency` required | `{ kind, currency, fee }` | The one legacy compatibility read, signed through TAPI v1 rather than v2. A key-version refusal surfaces as `FUNDING_UNAUTHORIZED` naming this kind. |

Coin and network arguments are uppercased automatically. Empty histories return
`[]` (or `{ data: [] }` for fiat, matching the exchange shape) and are normal
for quiet accounts.

## Argument validation moved into the handler

The five reads need different arguments, so `indodax_funding` declares them all
as optional and checks the ones the chosen `kind` needs. A missing `coin`,
`network`, or `currency` is therefore a `ValidationError` in the response
envelope at call time, rather than a protocol-level schema rejection. Treat it
as a validation failure and correct the arguments.

## What replaced the removed tools

`indodax_withdraw_history`, `indodax_deposit_history`, `indodax_fiat_history`,
`indodax_deposit_address`, and `indodax_withdraw_fee` became the `kind`
argument on this one tool. All five were read-only, all five needed
credentials, and none could mutate anything, so nothing was lost in the merge.

Every grant-shaped refusal on this tool carries
`reason: FUNDING_UNAUTHORIZED` with `haveGrant: false`, `needGrant`, and the
refusing `kind`, so a harness branches on one reason instead of five prose
shapes. IP allowlist refusals keep their own egress remedy and are never
relabelled. See the errors guide for the full code table.

Related: account tools, history tools, `indodax_funding_withdraw` (still denied
by design).