# ADR-002: Risk boundary

> Historical record from the Rust workspace. See [Rust to TypeScript](../migration/rust-to-typescript.md) for current locations.

* Status: accepted.
* Decision: `RiskEngine.evaluate` is pure and has no dependency on MCP,
  strategy, transport, or storage.
* Consequence: every live order path must present an approving
  `RiskDecision` (`ALLOW`).
  `ExecutionService` re-checks even if callers already checked.
