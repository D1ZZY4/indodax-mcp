# Execution flow

```mermaid
flowchart TD
    Intent["TradeIntent from agent or CLI"] --> Propose["TradingService propose"]
    Propose --> Order["Build Order in Proposed"]
    Order --> Review["Review: Validating to RiskCheck"]
    Review --> Risk{"RiskEngine verdict?"}
    Risk -->|"Approved"| Submit["Submitting"]
    Risk -->|"Rejected"| Rejected["Rejected"]
    Submit --> Backend{"Backend result?"}
    Backend -->|"Ack"| Open["Open"]
    Backend -->|"Timeout"| Unknown["Unknown"]
    Unknown --> Recon["Reconcile before retry"]
    Recon --> Submit
    Open --> Done["Filled / Cancelled"]
```

```mermaid
stateDiagram-v2
    [*] --> Proposed
    Proposed --> Validating
    Validating --> RiskCheck
    Validating --> Rejected
    RiskCheck --> Approved
    RiskCheck --> Rejected
    Approved --> Submitting
    Submitting --> Open
    Submitting --> SubmitFailed
    Submitting --> Unknown
    Unknown --> Open
    Unknown --> Filled
    Unknown --> SubmitFailed
    Open --> PartiallyFilled
    Open --> Filled
    Open --> CancelRequested
    Open --> Expired
    PartiallyFilled --> Filled
    PartiallyFilled --> CancelRequested
    CancelRequested --> Cancelled
    CancelRequested --> Filled
    Rejected --> [*]
    SubmitFailed --> [*]
    Filled --> [*]
    Cancelled --> [*]
    Expired --> [*]
```

1. Agent or CLI produces a `TradeIntent`.
2. `TradingService::propose` validates shape and records audit.
3. `TradingService::to_order` builds a typed `Order` in `Proposed`.
4. `TradingService::review` moves `Proposed → Validating → RiskCheck`,
   evaluates `RiskEngine`, then `Approved → Submitting` or `Rejected`.
5. `ExecutionService::execute` requires an approving `RiskDecision`
   and calls exactly one backend (`paper` or `live`).
6. Order machine records `Open → Filled/Cancelled/Unknown`.
7. Unknown outcomes (timeout) trigger reconciliation before retry.
