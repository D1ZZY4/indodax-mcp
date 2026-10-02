<h1 align="center">ADR-009: Unknown outcomes and execution safety</h1>

- Status: accepted.
- Current location: packages/indodax-execution and packages/indodax-orders.

## Decision

Paper and live requests share the execution contract. An **ambiguous exchange result must be treated as `UNKNOWN`** rather than assumed failed.

A state-changing retry must be preceded by reconciliation when the prior request could have been accepted by the exchange.

## Current implementation boundary

ExecutionService enforces an ALLOW risk decision before backend submission.

The current generic transport helper still retries state-changing HTTP requests without operation-aware idempotency. The live application path is disabled, but this must be corrected before live enablement.

## Consequence

Do not remove UNKNOWN or reconciliation states merely to simplify control flow. Safety depends on preserving uncertainty until evidence resolves it.
