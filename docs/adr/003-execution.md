# ADR-003: Paper and live backends

- Status: accepted.
- Current location: packages/indodax-execution and packages/indodax-paper.

## Decision

Paper and live execution share one ExecutionBackend contract and one ExecutionService boundary.

ExecutionService accepts an execution request only when risk returns ALLOW.

## Consequence

Paper execution exercises the same request and risk contracts without routing paper orders to the exchange.

LiveExecutor remains isolated behind the same contract. The current application policy keeps it disabled.

Unknown live outcomes require reconciliation before another state-changing request. The generic transport layer still needs idempotency-aware integration before this invariant can be considered fully enforced.
