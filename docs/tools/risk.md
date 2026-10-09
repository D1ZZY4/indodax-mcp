<h1 align="center">Risk tools</h1>

The engine is deterministic and side-effect free: policy plus limits plus a
supplied runtime context produce ALLOW, DENY, or HALT with machine-readable
`RiskReason` codes. Branch on codes, never on message text. Denial messages
additionally carry a `next:` remedy (which tool to call, how long to wait,
which limit was hit) so harnesses can act without guessing.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_risk_limits` | none | Limits as strings (notionals in quote-asset units, durations in ms) | Defaults: min 10,000, max order 10,000,000, max position 100,000,000, daily loss 5,000,000, 100 trades, 5s cooldown, market 60s, account 120s. |
| `indodax_risk_state` | none | `{ killSwitch, circuitBreaker, allowedModes, allowedCapabilities, deadman, halted, haltReason, reconciliationHalted, deadmanHalted }` | Read-only. `halted` is derived from the live ledger, policy, and deadman state, never cached, so calling this tool cannot open or close the trading path. `haltReason` names the condition (`killSwitch`, `circuitBreaker`, `reconciliationHalted`, or `deadmanSTALE`/`deadmanEXPIRED`) or is `null`. `deadmanHalted` is stated separately because DISARMED is an explicit opt-out that never blocks, while STALE and EXPIRED halt live trading. |
| `indodax_risk_evaluate` | `pair`, `side`, `quantity` positive, `price` positive, `mode` paper/live optional, `riskBudget`? positive in quote units, `stopPrice`? | `{ outcome, reasons, message, notional, riskBudget, notionalMultiple, riskAmount, riskMultiple, riskWarning, riskNote, minimumQty, currentNotional, minimumNotional, limits: { minOrderNotional, maxOrderNotional } }` | Executes nothing. `notional`/`limits` let callers branch without recomputing. `notionalMultiple` is sizing info and never warns; with `stopPrice` the stop-distance `riskMultiple` warns above 1x. |

Common reasons: `LIVE_MODE_DENIED`, `CAPABILITY_DENIED`, `MIN_ORDER_SIZE`,
`MAX_ORDER_SIZE`, `MAX_POSITION_EXPOSURE`, `DAILY_LOSS_LIMIT`,
`MAX_TRADE_COUNT`, `COOLDOWN_ACTIVE`, `DUPLICATE_ORDER`, `STALE_MARKET_DATA`,
`STALE_ACCOUNT_STATE`, `INSUFFICIENT_BALANCE`, `MARKET_SUSPENDED`,
`DEADMAN_UNKNOWN`, `INVALID_ORDER`. Kill switch, circuit breaker, and
reconciliation halt produce `HALT`, which closes the trading path.

Market suspension resolves from the live pair list; a market never reached
stays unknown rather than fresh. STALE/EXPIRED Deadman denies live (paper
placement halts too); DISARMED is an explicit opt-out.

## Sizing cheap coins against the notional floor

Every order must clear the pair minimum (often Rp10.000) and the
application minimum alike. For a small position that means sizing from the
stop backwards, not from the entry forwards:

1. Pick the stop distance first (e.g. 5% below entry).
2. Check `indodax_suggest_stop` (or the `tradeMinQuote` in `indodax_round_order`
   rules): the stop notional `quantity * stopPrice` must clear both floors.
3. When it cannot, either size the position up so the stop clears, or monitor
   with `indodax_alert_create` at the level instead of arming a stop that
   cannot place (`UNDERMINIMUM_STOP` refuses it with the shortfall math).

A 1%-risk budget smaller than the floor is structurally unprotectable at
full size: no stop price makes `quantity * stopPrice` reach the minimum, so
the position size itself must grow or stay manually monitored.

Related: order tools, `risk://state` resource, `docs/risk/policy.md`.
