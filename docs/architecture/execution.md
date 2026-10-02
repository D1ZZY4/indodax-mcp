# Execution flow

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

1. Agent or CLI produces a `TradeIntent`.
2. `TradingService.propose` validates shape and records audit.
3. `TradingService.toOrder` builds a typed `OrderRecord` in `NEW`.
4. `TradingService.review` moves `NEW → SUBMITTING`, evaluates the
   risk engine, then `ACCEPTED` or `REJECTED`.
5. `ExecutionService.execute` requires an approving `RiskDecision`
   and calls exactly one backend (`paper` or `live`).
6. Order machine records `Open → Filled/Cancelled/Unknown`.
7. Unknown outcomes (timeout) trigger reconciliation before retry.
