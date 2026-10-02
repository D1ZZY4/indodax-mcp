# MCP tool implementation

```mermaid
sequenceDiagram
    participant A as Agent
    participant M as MCP tool
    participant T as TradingService
    participant R as RiskEngine
    participant E as ExecutionService
    A->>M: propose trade
    M->>T: validate intent
    T->>R: evaluate context
    R-->>T: ALLOW or DENY with reason
    T-->>M: proposal plus verdict
    M-->>A: result, nothing executed yet
```

Each area under `tools/` owns three things: the tool schemas agents see,
the registration in the shared registry, and the calls into shared services.
Nothing in this folder signs requests, manages sockets, or decides risk.
Those live in `indodax-client`, `indodax-websocket`, and `indodax-risk`.

* `market.ts`: live public reads through `MarketService`.
* `account.ts`: credential-gated reads through `AccountService`.
* `orders.ts`: validate and propose through `TradingService`; paper
  placement goes through `ExecutionService` with an approved decision.
* `paper.ts`: simulation state through `PaperBackend`.
* `risk.ts`: pure evaluation through `RiskEngine`.
* `system.ts`: health, mode, capabilities, credential presence, funding
  reads, withdrawal denial, WebSocket snapshots.

Mutations need stronger guards than reads. Withdrawal stays on the
separate `funding.withdraw` capability and is denied by default.
