<h1 align="center">Execution flow</h1>

The repository uses one execution contract for paper and live backends. The supported application mode today is paper.

## Runtime flow

```mermaid
flowchart TD
    Intent["TradeIntent from agent or CLI"] --> Propose["TradingService propose"]
    Propose --> Order["Build OrderRecord in NEW"]
    Order --> Review["Review: NEW to SUBMITTING"]
    Review --> Risk{"RiskEngine verdict?"}
    Risk -->|"Allow"| Submit["ExecutionService"]
    Risk -->|"Deny"| Rejected["REJECTED"]
    Risk -->|"Halt"| Halted["HALT"]
    Submit --> Backend{"Backend result?"}
    Backend -->|"Ack"| Open["ACCEPTED"]
    Backend -->|"Timeout"| Unknown["UNKNOWN"]
    Unknown --> Recon["Reconcile before retry"]
    Recon --> Submit
    Open --> Done["FILLED / CANCELLED"]
```

Paper order placement follows the **full** intent, proposal, risk review, and execution path.

## Order lifecycle

```mermaid
stateDiagram-v2
    [*] --> NEW
    NEW --> SUBMITTING
    SUBMITTING --> ACCEPTED
    SUBMITTING --> REJECTED
    SUBMITTING --> UNKNOWN
    UNKNOWN --> ACCEPTED
    UNKNOWN --> FILLED
    UNKNOWN --> REJECTED
    UNKNOWN --> RECONCILING
    RECONCILING --> RECONCILED
    RECONCILING --> ACCEPTED
    RECONCILING --> FILLED
    RECONCILING --> CANCELLED
    ACCEPTED --> PARTIALLY_FILLED
    ACCEPTED --> FILLED
    ACCEPTED --> CANCELLING
    ACCEPTED --> RECONCILING
    PARTIALLY_FILLED --> FILLED
    PARTIALLY_FILLED --> CANCELLING
    PARTIALLY_FILLED --> RECONCILING
    CANCELLING --> CANCELLED
    CANCELLING --> FILLED
    CANCELLING --> UNKNOWN
    REJECTED --> [*]
    FILLED --> [*]
    CANCELLED --> [*]
    RECONCILED --> [*]
```

Canonical order states live in @indodax-mcp/indodax-orders.

## Live execution boundary

LiveExecutor implements the TAPI v2 order and cancel adapters with timeInForce and self-trade prevention passthrough. The composition selects paperOnlyPolicy by default and liveEnabledPolicy when `APP_ENV=live`, so live placement needs credentials, acknowledgement, and risk approval.

State-changing requests attempt exactly once by default; callers opt into `retryStateChanging` only with proven idempotency. Paper placement replays repeated `clientOrderId` values instead of submitting twice.

## Stop protection is bounded by the server process

A stop created through `indodax_stop_create` is emulated server-side, because
the exchange has no native stop order. It fires only while this server is
running and only when `indodax_stop_check` or the `STOP_AUTOPOLL_MS` autopoll
evaluates it. Take-profit limit orders are different: they rest on the exchange
and survive any server outage.

```mermaid
flowchart LR
    Pos["Open position"] --> TP["Take-profit limit<br/>rests on the exchange<br/>survives an outage"]
    Pos --> Stop["Server-side stop<br/>needs this process alive"]
    Stop --> SC["indodax_stop_check<br/>or STOP_AUTOPOLL_MS"]
    Pos --> DM["Exchange Deadman<br/>cancels on the exchange when heartbeats lapse"]
```

An operator relying on stops therefore has to keep the server running or use
the exchange Deadman, which fails closed on its own. This is why `indodax_stops`
reports `blocked` separately from `open`, and why a live stop records
`acknowledgedAt`: a live stop is a standing instruction to this process, not an
order on the exchange.

## Refused stops that stay armed

Retiring a stop on any refusal removes protection from a position that is still
open. Three outcomes are therefore distinguished:

- `blocked`: the quantity is reserved by another order and the exchange refused
  with `-2010`. The stop stays armed and retries, because the locking order can
  be cancelled.
- `retry`: a refreshable local refusal such as `STALE_ACCOUNT_STATE`,
  `STALE_MARKET_DATA` or `COOLDOWN_ACTIVE`. The stop stays armed because the
  next cycle can clear it. The classification inspects every reason code in the
  denial, so a stale reason that is not listed first is still recognised.
- `failed`: a terminal refusal, retired so it cannot retry indefinitely.

## Unknown outcomes

A timeout or dropped connection is **not evidence** that the exchange rejected an order.

The required production sequence is:

1. preserve the client order identifier;
2. mark the operation as unknown;
3. reconcile against exchange order and trade state;
4. decide whether another request is safe.

The current reconciliation package contains comparison primitives, but the MCP reconciliation tools are not yet a complete exchange-state reconciliation workflow.

## Safety invariant

ExecutionService requires an ALLOW risk decision before calling a backend. This is necessary but not sufficient for production live execution; the surrounding application still needs complete context, durable state, reconciliation, and idempotency controls.
