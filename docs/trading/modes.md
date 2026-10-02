# Trading modes

```mermaid
flowchart LR
    Call["Mutation tool call"] --> Mode{"Explicit live mode?"}
    Mode -->|"No"| Paper["Paper backend"]
    Mode -->|"Yes"| Cap{"Live capability plus ack?"}
    Cap -->|"No"| Denied["Denied"]
    Cap -->|"Yes"| Policy{"Server policy allows?"}
    Policy -->|"No"| Denied
    Policy -->|"Yes"| Live["Live backend"]
```

Paper is the default. Every mutation tool assumes paper unless the
caller explicitly passes live mode with the matching capability and
acknowledgement, and the server policy still has the final word.

The pipeline is fixed: `TradingService` validates intents,
`RiskEngine` approves or denies, `ExecutionService` calls exactly one
backend. Unknown exchange outcomes (timeouts, dropped connections)
resolve through reconciliation before any retry, because a timeout is
not proof that the order failed.
