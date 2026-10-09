<h1 align="center">Operations tools</h1>

Cross-cutting helpers: stored backtests, exposure, sockets, and the private
channel lifecycle.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_backtest_get` | `id` | Stored report with trade journal | Bounded at 100 runs. |
| `indodax_backtest_compare` | `ids` array, 2-10 | `{ rows, best }` ranked by net PnL | none |
| `indodax_strategy_validate` | `id`, `closes`, `window`? | `{ id, valid, errors }` | Input check only. |
| `indodax_reconcile_trades` | `symbol` | Fill comparison vs v2 `myTrades` | Needs credentials. |
| `indodax_audit_risk` | `limit`? default 20 | Risk decision entries | none |
| `indodax_exposure` | none | `{ exposure: [{ asset, amount, valueIdr }], totalIdr, incomplete }` | Paper balances at live prices; `totalIdr` sums priced rows only. |
| `indodax_ws_reconnect` | `scope` market/private/all default all | `{ scope, reconnected, connected, restored, marketState, note, reasons?, partial? }` | Market scope drops and re-establishes the socket, restoring registry subscriptions with offsets. Each leg is reported independently: `connected` lists the legs that succeeded, `reasons` names each leg that failed, and `partial` is true when a multi-leg request had one leg succeed and another fail. `reconnected` is false when no requested leg connected. A private leg blocked by missing credentials does not discard a market leg that already reconnected. |
| `indodax_private_connect` | none | `{ channel, state }`, never the token | Needs credentials. Opens a real live channel (global state); disconnect with `indodax_private_disconnect` when done. The channel hash is masked (first and last four characters) because status output is logged on every poll. |
| `indodax_private_disconnect` | none | `{ state }` | Drops the private channel without touching credentials. |

Related: strategy, audit, reconcile, and system tool guides.
