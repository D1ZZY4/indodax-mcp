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
| `indodax_risk_evaluate` | `pair`, `side`, `quantity` positive, `price` positive, `mode` paper/live optional, `riskBudget` positive optional in quote units | `{ outcome, reasons, message, notional, riskBudget, riskMultiple, riskWarning, limits: { minOrderNotional, maxOrderNotional } }` | Executes nothing. `notional`/`limits` let callers branch without recomputing. `riskBudget` adds an advisory multiple and warning above 1x without changing the verdict. |

Common reasons: `LIVE_MODE_DENIED`, `CAPABILITY_DENIED`, `MIN_ORDER_SIZE`,
`MAX_ORDER_SIZE`, `MAX_POSITION_EXPOSURE`, `DAILY_LOSS_LIMIT`,
`MAX_TRADE_COUNT`, `COOLDOWN_ACTIVE`, `DUPLICATE_ORDER`, `STALE_MARKET_DATA`,
`STALE_ACCOUNT_STATE`, `INSUFFICIENT_BALANCE`, `MARKET_SUSPENDED`,
`DEADMAN_UNKNOWN`, `INVALID_ORDER`. Kill switch, circuit breaker, and
reconciliation halt produce `HALT`, which closes the trading path.

Market suspension resolves from the live pair list; a market never reached
stays unknown rather than fresh. STALE/EXPIRED Deadman denies live (paper
placement halts too); DISARMED is an explicit opt-out.

Related: order tools, `risk://state` resource, `docs/risk/policy.md`.
