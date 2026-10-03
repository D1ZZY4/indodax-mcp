<h1 align="center">Risk register</h1>

## R1. Runtime persistence is not durable

The repository contains PostgreSQL schema and repository implementations, but the main application composition currently uses in-memory paper, alert, audit, and runtime state.

Impact: process restart **can lose application state**, so persistence must **not be described as complete**.

Mitigation: wire repositories into the application composition and add restart/recovery integration tests.

## R2. Reconciliation is only partially integrated

Reconciliation primitives compare local and exchange orders, fills, and balances, but the MCP reconciliation tools are currently paper/local oriented.

Impact: an application-local result is **not equivalent to exchange truth**.

Mitigation: wire authenticated exchange order/trade reads into a durable reconciliation workflow before any live enablement.

## R3. Risk context is partially authoritative

The risk engine supports freshness, daily loss, position exposure, cooldown, balance, and other checks. MCP callers now resolve trade count, cooldown, duplicates, position exposure, and daily PnL from the live ledger, with market freshness from a last-seen ticker read that grows stale offline. Daily PnL marks realized fills plus open-position unrealized at live prices; quantities without tracked basis contribute zero rather than invented gains.

Impact: the policy primitive is **deterministic**, and most inputs are now authoritative. A market never reached stays unknown rather than fresh.

Mitigation: keep resolving context from current market, account, portfolio, and reconciliation state; treat a null market age as unknown rather than fresh.

## R4. State-changing retries are classified (resolved)

The generic transport retry helper retries 429, 5xx, and timeouts for safe methods only. State-changing requests attempt exactly once unless the caller opts into `retryStateChanging`, and paper placement replays repeated `clientOrderId` values instead of submitting twice.

Impact: a lost response after a successful order submission no longer triggers a blind duplicate; callers must still reconcile unknown order state before resubmission.

Mitigation: keep client order IDs on every mutating path and test duplicate scenarios.

## R5. Private WebSocket lifecycle has a dedicated manager

The official private WebSocket uses a generated private token and a private-channel connection/subscription message shape. A dedicated `PrivateChannelManager` now handles token refresh ahead of the 24h expiry, channel subscribe, and bounded exponential reconnect.

Impact: private order-event synchronization is now covered by unit-tested lifecycle logic, though live socket traffic remains unverified without exchange credentials.

Mitigation: keep renewal, reconnect, and order-event reconciliation tests current with the official private-channel contract.

## R6. MCP metadata is partially centralized

Tool metadata describes capability, environment, authentication, destructiveness, idempotency, and audit class. A central guard enforces authentication and environment; capability, risk, and audit enforcement stays in handlers and the risk engine.

Impact: a new mutation tool with incomplete handler guards can still be misguarded for capability or risk paths.

Mitigation: keep executable policy guards mandatory at the service boundary and extend central coverage only with matching tests.

## R7. Exchange quota and application throttle are separate controls

The official API publishes endpoint-specific limits. The repository also has application throttle buckets.

Impact: an application setting should **not be interpreted as the exchange quota**.

Mitigation: maintain endpoint-specific exchange limit documentation and treat local throttle as an additional safety control.

## R8. Protocol and dependency drift

MCP SDK, Vite, TypeScript, INDODAX API, and WebSocket behavior can change independently.

Mitigation: keep compatibility snapshots, official source references, and regression tests current.
