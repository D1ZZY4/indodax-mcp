<h1 align="center">Operations tools</h1>

Cross-cutting helpers: stored backtests, exposure, and the socket and private
channel lifecycle. See the strategy page for `indodax_backtest` and the
reconcile page for the reconciliation tools.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_backtest` | `ids` array of 1 to 10 | one report with its trade journal, or `{ count, rows, best }` | Registered under strategy tools. |
| `indodax_exposure` | none | `{ count, exposure: [{ asset, amount, valueIdr }], totalIdr, incomplete }` | Paper balances at live prices; `totalIdr` sums priced rows only. |
| `indodax_ws_reconnect` | `scope` market/private/all default all | `{ scope, reconnected, connected, restored, marketState, note, reasons?, partial? }` | Market scope drops and re-establishes the socket, restoring registry subscriptions with offsets. Each leg is reported independently: `connected` lists the legs that succeeded, `reasons` names each leg that failed, and `partial` is true when a multi-leg request had one leg succeed and another fail. `reconnected` is false when no requested leg connected. |
| `indodax_private_channel` | `action` connect or disconnect | `{ action, channel?, state }` | Needs credentials. `connect` fetches a private token and subscribes, returning the masked channel and state, never the token. `disconnect` drops the channel without touching credentials or tokens. |

## The private channel action pair

`connect` and `disconnect` are the same channel and the same manager, one
opening and one closing, so they share one tool. One consequence is deliberate
and worth knowing: the merged tool declares `authRequirement: credentials`
because connect needs it, so **disconnecting now also requires a configured
key** where it previously did not. That narrows the accepted input, which is
one of the breaking changes in this release.

## What replaced the removed tools

| Removed | Now |
| --- | --- |
| retired `indodax_backtest_get` | `indodax_backtest` with a single-element `ids` |
| retired `indodax_backtest_compare` | `indodax_backtest` with two to ten `ids` |
| retired `indodax_private_connect` | `indodax_private_channel` with `action: "connect"` |
| retired `indodax_private_disconnect` | `indodax_private_channel` with `action: "disconnect"` |
| retired `indodax_strategy_validate` | `indodax_strategy_evaluate` with `validateOnly: true` (strategy page) |
| retired `indodax_audit_risk` | `indodax_audit` with `kinds: ["RiskApproved","RiskRejected"]` (audit page) |
| retired `indodax_reconcile_trades` | `indodax_reconcile_exchange` with `scope: "trades"` (reconcile page) |

The private channel hash is masked (first and last four characters) because
status output is logged on every poll.

Related: strategy, audit, reconcile, and system tool guides.