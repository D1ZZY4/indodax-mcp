<h1 align="center">ADR-002: Risk boundary</h1>

- Status: accepted.
- Current location: packages/indodax-risk and packages/indodax-execution.

## Decision

Risk evaluation remains **deterministic and side-effect free**. It should not depend on MCP, strategy, transport, or database access.

Execution must require an approving ALLOW risk decision at the ExecutionService boundary.

## Current implementation

The risk engine evaluates policy, mode, capability, Deadman state for live contexts, duplicate state, freshness, notional limits, daily loss, trade count, balance, position exposure, and cooldown.

The current application policy is paper-only. The live adapter exists, but the composed application does not currently authorize live execution.

This ADR defines the boundary; it does not claim that every caller currently supplies complete authoritative runtime context.
