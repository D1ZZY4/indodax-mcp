<h1 align="center">Strategy and backtest tools</h1>

Strategies emit signals; they never place orders. Backtests replay closes as
hypothetical fills in process memory; they are not durable records and do not
demonstrate profitability.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_strategies` | `id`? string | `{ count, strategies }`, or one strategy plus `executesOrders: false` | `id` returns a single strategy instead of the whole list. `executesOrders` is always false. |
| `indodax_strategy_evaluate` | `pair`, `closes` array of positive numbers, `window`? int default 5 | `{ pair, side, strength, confidence, trend, reason, verdict, closes, window, advisory }` | A signal, not an order. With `verdict: insufficient_data` the side and strength are `null` rather than invented. `advisory` carries an optional second opinion (see below) and never affects the signal. |
| `indodax_strategy_evaluate` with `validateOnly` | `closes`, `window`?, `id`? default `ma-cross`, `validateOnly: true` | `{ id, valid, errors, closes, window }` | Input check only, no computation, and nothing throws: every problem comes back as an entry in `errors`. |
| `indodax_backtest_run` | `closes` (min 2), `threshold` fraction positive default 0.05, `feeRate` non-negative default 0.0026, `notional` positive default 1000 | `{ id, note, inputs, signalsEvaluated, hypotheticalFills, totalFees, netPnl, expectancy, maxDrawdownPct, trades }` | Money as strings. The replay assumes fees with no slippage. Stored runs are bounded at 100, oldest evicted. |
| `indodax_backtest` | `ids` array of 1 to 10 | one report with its trade journal, or `{ count, rows, best }` when two or more | Ranked by net PnL descending. Registered under ops tools. |

## The two evaluate modes

`indodax_strategy_evaluate` answers two different questions, so the mode is an
argument rather than two tools.

- **Default (compute).** `pair` is required. Shape faults such as fewer than
  two closes are a `ValidationError`, because those are caller mistakes. A
  window wider than the available history is separated out and returned as
  `verdict: insufficient_data` with `side: null`, so a scan over many pairs does
  not have to catch an exception and never renders `NaN%` from an absent
  signal.
- **`validateOnly: true`.** `pair` is not required and nothing throws. Every
  problem, including an empty `closes`, comes back in `errors`. Use this when
  checking inputs before a scan.

Supplying neither `pair` nor `validateOnly: true` is refused as a
`ValidationError`.

## Optional Jev advisory

`indodax_strategy_evaluate` can carry a second opinion from
[Jev](https://opencode.ai/docs/zen/), reached through the OpenCode Zen System One
endpoint with the free model `jev-1.13-free`. It is off unless
`OPENCODE_API_KEY` is set, and it appears under `advisory`:

```json
{
  "role": "advisory only; it does not gate, alter, or authorise this signal",
  "available": true,
  "model": "jev-1.13-free",
  "verdict": {
    "confidence": 0.93,
    "classification": "routine",
    "momentum": 0.87,
    "highConfidence": true
  }
}
```

What it is and is not:

- It **only ever uses the free model**, so the advisory cannot incur a charge. If
  the free model is withdrawn the advisory reports unavailable rather than
  falling back to the paid `jev-1.13`.
- It **cannot approve anything**. The deterministic risk engine, the central
  guard, mode and capability checks, per-call acknowledgement, and every
  idempotency and balance rule run independently and are unaffected.
- A missing credential, an unreachable endpoint, a timeout, a rate limit, a
  malformed body, or a low-confidence answer all degrade to `available: false`
  with a reason. None of them fail the tool or change the signal.
- `highConfidence` is true only when every answer cleared the confidence floor.
  A low-confidence answer is reported as such rather than presented as fact.
- Only a summary of the public close series, the pair, the side, and the signal
  strength are sent. No key, secret, account identifier, order identifier, or
  balance leaves the process.

Set `OPENCODE_API_KEY` to enable it. Everything else behaves identically without
it.

## What replaced the removed tools

| Removed | Now |
| --- | --- |
| retired `indodax_strategy` | `indodax_strategies` with `id` |
| retired `indodax_strategy_validate` | `indodax_strategy_evaluate` with `validateOnly: true` |
| retired `indodax_backtest_get` | `indodax_backtest` with a single-element `ids` |
| retired `indodax_backtest_compare` | `indodax_backtest` with two to ten `ids` |

The backtest pair read the same stored-run map, and comparison was just a
lookup over a list plus a sort. One argument now selects between them.

Win rate is deliberately absent from a backtest report: threshold crossings are
counted as fills without modeling direction, so every crossing would trivially
"win". `expectancy` is net per hypothetical fill.

Related: paper tools (real simulation), `docs/guides/advanced.md` backtests.