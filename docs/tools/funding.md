<h1 align="center">Funding tools</h1>

Authenticated read-only funding information. Coin and network arguments are
uppercased automatically. Withdrawal mutations are always denied (see system
tools); these tools only read history, addresses, and fees.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_withdraw_history` | `coin`? (default BTC server-side; max 90 days) | Array of `{ id, amount, transactionFee, coin, address, txId, network, status, applyTime, completeTime }` | Needs credentials. |
| `indodax_deposit_history` | `coin`? (same defaults) | Array of deposits with `insertTime`/`completeTime` | Needs credentials. |
| `indodax_fiat_history` | none (max 30 days) | `{ data: [{ orderNo, amount, totalFee, method, fiatCurrency, status, createTime, updateTime, bankName, bankTag, bankAccountNumber }] }` | Needs credentials. |
| `indodax_deposit_address` | `coin` required, `network` required | Array of `{ coin, address, tag, network }` | Empty array with no message means no address was generated yet. |
| `indodax_withdraw_fee` | `currency` required | `{ server_time, withdraw_fee, currency }` | Legacy compatibility read. |

Empty histories return `[]` (or `{ data: [] }` for fiat, matching the exchange
shape) and are normal for quiet accounts.

Related: account tools, history tools.
