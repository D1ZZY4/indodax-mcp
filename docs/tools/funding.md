<h1 align="center">Funding tools</h1>

Authenticated read-only funding information. Coin and network arguments are
uppercased automatically. Withdrawal mutations are always denied (see system
tools); these tools only read history, addresses, and fees.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_withdraw_history` | `coin`? crypto only (default BTC server-side; max 90 days) | Array of `{ id, amount, transactionFee, coin, address, txId, network, status, applyTime, completeTime }` | Needs credentials. `coin: IDR` is rejected up front with a pointer to `indodax_fiat_history`. |
| `indodax_deposit_history` | `coin`? crypto only (same defaults) | Array of deposits with `insertTime`/`completeTime` | Needs credentials. Same IDR rule as above. |
| `indodax_fiat_history` | none (max 30 days) | `{ data: [{ orderNo, amount, totalFee, method, fiatCurrency, status, createTime, updateTime, bankName, bankTag, bankAccountNumber }] }` | Needs credentials. The IDR path. |
| `indodax_deposit_address` | `coin` required crypto, `network` required | `{ coin, network, count, addresses, permitted: true, summary }` | Empty addresses with `permitted: true` means no address was generated yet (the read itself was allowed). A grant refusal fails instead as `FUNDING_UNAUTHORIZED`. |
| `indodax_withdraw_fee` | `currency` required | `{ server_time, withdraw_fee, currency }` | Legacy compatibility read. A key-version refusal surfaces as `FUNDING_UNAUTHORIZED` naming the tool. |

Empty histories return `[]` (or `{ data: [] }` for fiat, matching the exchange
shape) and are normal for quiet accounts.

Every grant-shaped refusal on these tools carries `reason: FUNDING_UNAUTHORIZED`
with `haveGrant: false`, `needGrant`, and the refusing `tool`, so a harness
branches on one reason instead of four prose shapes. IP allowlist refusals keep
their own egress remedy and are never relabeled. See the errors guide for the
full code table.

Related: account tools, history tools.
