<h1 align="center">Risk policy</h1>

The risk engine is **deterministic and side-effect free**. It evaluates an order against a policy and a supplied runtime context.

## Current policy

Paper is default via paperOnlyPolicy:

~~~text
allowedModes = ["paper"]
allowedCapabilities = ["READ", "PAPER"]
killSwitch = false
circuitBreaker = false
~~~

With `APP_ENV=live` plus `TRADE_ENABLED=true` the composition uses liveEnabledPolicy:

~~~text
allowedModes = ["paper", "live"]
allowedCapabilities = ["READ", "PAPER", "TRADE"]
~~~

Live still needs credentials, acknowledgement, and risk ALLOW. Withdrawal stays denied.

## Evaluation order

```mermaid
flowchart TD
    Req["Order plus context"] --> Halt{"Kill switch, breaker, halted reconcile?"}
    Halt -->|"Yes"| HaltOut["HALT: path closed"]
    Halt -->|"No"| Live{"Live mode and TradePlace?"}
    Live -->|"Missing"| Deny1["DENY: capability denial"]
    Live -->|"Present"| Checks{"Limits, loss, stale data, duplicate, cooldown?"}
    Checks -->|"Fail"| Deny2["DENY with RiskReason"]
    Checks -->|"Pass"| Allow["ALLOW"]
```

A failed rule produces a machine-readable `RiskReason`. Kill switch, circuit breaker, and reconciliation halt produce `HALT`; other rule failures produce `DENY`.

## Default limits

| Limit | Default |
| --- | ---: |
| Maximum order notional | 10,000,000 |
| Minimum order notional | 10,000 |
| Maximum position notional | 100,000,000 |
| Maximum daily loss | 5,000,000 |
| Maximum trade count | 100 |
| Order cooldown | 5,000 ms |
| Maximum market age | 60,000 ms |
| Maximum account age | 120,000 ms |

Financial limits use `Decimal`.

## Runtime limitation

The engine can evaluate all fields above, but **not every MCP entrypoint supplies every input**.

Most callers resolve context from current application state through the shared resolver: market age from the last successful ticker read (unknown when never reached, never fresh by default), account age from the last authenticated read, and trade count, cooldown, duplicates, position exposure, and daily PnL from the live paper ledger. Balance sufficiency is supplied only by callers that compute it (paper placement); other paths leave it null and skip the check.

Treat the risk engine as a **correct policy primitive**, not as proof that every caller supplies complete market, account, PnL, and position state.

## Denial semantics

Agents should branch on **reason codes** rather than message strings.

Examples include:
- LIVE_MODE_DENIED
- CAPABILITY_DENIED
- MIN_ORDER_SIZE
- MAX_ORDER_SIZE
- DAILY_LOSS_LIMIT
- MAX_POSITION_EXPOSURE
- COOLDOWN_ACTIVE
- STALE_MARKET_DATA
- STALE_ACCOUNT_STATE
- INSUFFICIENT_BALANCE

A stale or expired Deadman switch halts paper placement as well as live trading. Disarm it when no heartbeat protection is intended.

Risk evaluation is **not a network operation** and must remain **deterministic**.
