<h1 align="center">Operations runbook</h1>

This runbook covers the current application and its operational limits. The main composition is paper-only and keeps operational state in memory.

## Validation

Run the repository gates before release or deployment:

~~~bash
bun run format:check
bun run lint
bunx turbo typecheck
bunx turbo test
bunx turbo build
bunx playwright test
bun run verify
~~~

The active GitHub workflow runs format, lint, typecheck, test, build, end-to-end, consumer verification, and migration drift checks.

## Health

```mermaid
stateDiagram-v2
    [*] --> healthy
    healthy --> degraded : minor check fails
    degraded --> healthy : recovers
    degraded --> unhealthy : more checks fail
    unhealthy --> degraded : partial recovery
    unhealthy --> halted : risk or reconcile halts
    degraded --> halted : risk or reconcile halts
    halted --> healthy : operator clears condition
```

Use indodax_health for the service rollup.

Use indodax_readiness to check whether the server considers itself able to serve traffic.

Use indodax_runtime_status for scheduler state, socket state, counters, and Deadman state.

A halted risk or reconciliation condition should be treated as a closed trading path. The current application is already paper-only, so health state does not enable live execution.

## Market and WebSocket checks

Use indodax_ws_status to inspect managed socket state and subscriptions.

Use indodax_ws_ticker for a one-shot market snapshot.

The managed WebSocket implementation currently supports authentication, subscriptions, offsets, and reconnect helpers, but the private WebSocket lifecycle is not a complete production integration. Do not treat a connected private socket as proof of durable order-state synchronization.

## Credential rotation

Credentials are read from process environment.

After rotating an INDODAX key:

1. update the deployment environment;
2. restart the MCP server and any long-running daemon;
3. call indodax_auth_status;
4. call indodax_account using read-only access;
5. review configuration and policy before any future live enablement.

Never place an order as a credential test.

## Database

The database package provides PostgreSQL schema, migrations, and repository implementations.

The current main application composition does not use PostgreSQL as its source of truth. Database health must therefore be evaluated separately from MCP application health until runtime wiring is completed.

## Incident handling

When an operation is ambiguous:

1. preserve the correlation id and client order id;
2. do not blindly retry a state-changing request;
3. inspect exchange order and trade state through authoritative reads;
4. compare local and exchange state;
5. record the incident and resulting decision.

The current reconciliation MCP tools are not yet a complete exchange reconciliation workflow.

## Recovery principle

Do not infer recovery from process health alone. A restarted process can be healthy while its in-memory paper state has reset. Durable recovery requires persistent state and replay/reconciliation integration that is not yet present in the main composition.
