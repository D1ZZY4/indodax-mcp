# ADR-002: Risk boundary

* Status: accepted.
* Decision: `RiskEngine::evaluate` is pure and has no dependency on MCP,
  strategy, transport, or storage.
* Consequence: every live order path must present a `RiskDecision::Allow`.
  `ExecutionService` re-checks even if callers already checked.
