# Trading

Paper is the default. Live requires explicit mode plus capability.
`TradingService` validates intents, `RiskEngine` approves, and
`ExecutionService` calls one backend. Unknown exchange outcomes reconcile
before any retry.
