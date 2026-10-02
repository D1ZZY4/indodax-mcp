# Risk register

## R1. Runtime persistence is not durable

The repository contains PostgreSQL schema and repository implementations, but the main application composition currently uses in-memory paper, alert, audit, and runtime state.

Impact: process restart can lose application state, so persistence must not be described as complete.

Mitigation: wire repositories into the application composition and add restart/recovery integration tests.

## R2. Reconciliation is only partially integrated

Reconciliation primitives compare local and exchange orders, fills, and balances, but the MCP reconciliation tools are currently paper/local oriented.

Impact: an application-local result is not equivalent to exchange truth.

Mitigation: wire authenticated exchange order/trade reads into a durable reconciliation workflow before any live enablement.

## R3. Risk context is incomplete at some entrypoints

The risk engine supports freshness, daily loss, position exposure, cooldown, balance, and other checks, but some MCP callers pass fixed freshness values, null PnL, or omit position context.

Impact: the policy primitive is deterministic, but the inputs are not always authoritative.

Mitigation: build runtime risk context from current market, account, portfolio, and reconciliation state.

## R4. State-changing retries are not idempotency-aware

The generic transport retry helper retries 429, 5xx, and timeouts without distinguishing GET from state-changing POST requests.

Impact: a lost response after a successful order submission could create an ambiguous client state.

Mitigation: preserve client order IDs, classify retry safety by operation, reconcile unknown order state before resubmission, and test duplicate scenarios.

## R5. Private WebSocket lifecycle is incomplete

The official private WebSocket uses a generated private token and a private-channel connection/subscription message shape. The current managed socket abstraction is built around the market-style protocol.

Impact: private order-event synchronization cannot yet be treated as production-complete.

Mitigation: implement a dedicated private protocol adapter with token generation, renewal, reconnect, and order-event reconciliation tests.

## R6. MCP metadata is partially centralized

Tool metadata describes capability, environment, authentication, destructiveness, idempotency, and audit class. A central guard enforces authentication and environment; capability, risk, and audit enforcement stays in handlers and the risk engine.

Impact: a new mutation tool with incomplete handler guards can still be misguarded for capability or risk paths.

Mitigation: keep executable policy guards mandatory at the service boundary and extend central coverage only with matching tests.

## R7. Exchange quota and application throttle are separate controls

The official API publishes endpoint-specific limits. The repository also has application throttle buckets.

Impact: an application setting should not be interpreted as the exchange quota.

Mitigation: maintain endpoint-specific exchange limit documentation and treat local throttle as an additional safety control.

## R8. Protocol and dependency drift

MCP SDK, Vite, TypeScript, INDODAX API, and WebSocket behavior can change independently.

Mitigation: keep compatibility snapshots, official source references, and regression tests current.
