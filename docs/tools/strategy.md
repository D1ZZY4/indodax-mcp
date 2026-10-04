<h1 align="center">Strategy and backtest tools</h1>

Strategies emit signals; they never place orders. Backtests replay closes as
hypothetical fills in process memory; they are not durable records and do not
demonstrate profitability.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_strategies` | none | `[{ id, description, parameters }]` (`ma-cross`, `momentum-threshold`) | `executesOrders` is always false. |
| `indodax_strategy` | `id` | One strategy plus `executesOrders: false` | — |
| `indodax_strategy_evaluate` | `pair`, `closes` array of positive numbers, `window` int positive default 5 | `{ symbol, side, strength 0-1, reason }` | `window` must fit inside `closes` or validation fails. `strength` is a float signal weight, not money. |
| `indodax_strategy_validate` | `id`, `closes`, `window`? | `{ id, valid, errors }` | Input check only, no computation. |
| `indodax_backtest_run` | `closes` (min 2), `threshold` positive default 0.05, `feeRate` non-negative default 0.0026, `notional` positive default 1000 | `{ id, note, inputs: { feeRate, threshold, notional }, signalsEvaluated, hypotheticalFills, totalFees, netPnl, maxDrawdownPct, trades }` | Money as strings. The `note` states the replay assumes fees with no slippage. Stored runs are bounded at 100, oldest evicted. |
| `indodax_backtest_get` | `id` | Stored report with trade journal | — |
| `indodax_backtest_compare` | `ids` array, 2-10 | `{ rows: [{ id, netPnl, fills }], best }` | Ranked by net PnL descending. |

Related: paper tools (real simulation), `docs/guides/advanced.md` backtests.
