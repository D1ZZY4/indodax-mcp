<h1 align="center">ADR-010: Deadman-gated live safety</h1>

- Status: accepted.

## Decision

Model Deadman state explicitly as `DISARMED`, `ARMED`, `STALE`, or `EXPIRED`. For any future live trading path, an unknown, stale, or expired safety heartbeat **must fail closed**.

For any live trading path, an unknown, stale, or expired safety heartbeat **must fail closed**. Paper stays the default.

## Implementation

The Deadman state machine is implemented in packages/indodax-deadman and exposed through operational tools.

The official exchange Deadman endpoint and private WebSocket lifecycle are separate concerns. Do not infer that the local state machine alone provides complete exchange-side Deadman protection.

## Consequence

Live execution integrates Deadman lifecycle, renewal, and failure handling into the same execution path as orders and reconciliation. DISARMED stays an explicit opt-out.
