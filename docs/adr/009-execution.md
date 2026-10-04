<h1 align="center">ADR-009: Unknown outcomes and execution safety</h1>

- Status: accepted.
- Current location: packages/indodax-execution and packages/indodax-orders.

## Decision

Paper and live requests share the execution contract. An **ambiguous exchange result must be treated as `UNKNOWN`** rather than assumed failed.

A state-changing retry must be preceded by reconciliation when the prior request could have been accepted by the exchange.

## Current implementation boundary

ExecutionService enforces an ALLOW risk decision before backend submission.

State-changing requests attempt exactly once by default and opt into retries only with proven idempotency. A timeout or network failure on live submission surfaces as an explicit non-retryable unknown outcome with the client order id preserved, instead of a blind duplicate.

## Consequence

Do not remove UNKNOWN or reconciliation states merely to simplify control flow. Safety depends on preserving uncertainty until evidence resolves it.
