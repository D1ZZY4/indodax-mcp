# ADR-010: Deadman-gated live safety

- Status: accepted.

## Decision

Model Deadman state explicitly as DISARMED, ARMED, STALE, or EXPIRED. For any future live trading path, an unknown, stale, or expired safety heartbeat must fail closed.

The current application policy is paper-only, so Deadman state does not currently unlock live trading.

## Implementation

The Deadman state machine is implemented in packages/indodax-deadman and exposed through operational tools.

The official exchange Deadman endpoint and private WebSocket lifecycle are separate concerns. Do not infer that the local state machine alone provides complete exchange-side Deadman protection.

## Consequence

Future live execution must integrate Deadman lifecycle, renewal, and failure handling into the same durable execution state used for orders and reconciliation.
