<h1 align="center">ADR-003: Paper and live backends</h1>

- Status: accepted.
- Current location: packages/indodax-execution and packages/indodax-paper.

## Decision

Paper and live execution **share one `ExecutionBackend` contract** and one `ExecutionService` boundary.

ExecutionService accepts an execution request only when risk returns ALLOW.

## Consequence

Paper execution exercises the same request and risk contracts without routing paper orders to the exchange.

LiveExecutor remains isolated behind the same contract. The current application policy keeps it disabled.

Unknown live outcomes require reconciliation before another state-changing request. State-changing requests attempt exactly once by default and opt into retries only with proven idempotency; ambiguous outcomes surface as explicit unknown results with the client order id preserved.
