# MCP tool implementation

MCP tools are protocol adapters around the application services and exchange-facing packages. Tool handlers should remain small so the same behavior can be tested without an MCP transport.

## Handler pattern

~~~text
MCP arguments
    |
    v
schema validation
    |
    v
operation-specific guard
    |
    v
application/service call
    |
    v
shared response envelope
~~~

Handlers must not own exchange signing, WebSocket protocol details, database access, or financial policy.

## Registration

Tool definitions live under packages/indodax-mcp/src/tools.

A normal tool has:

1. metadata,
2. a Zod input schema,
3. a handler registration,
4. conversion into the common response envelope.

The registry validates metadata when a tool is registered.

## Current groups

- market.ts: public market reads.
- account.ts: authenticated account reads.
- orders.ts: order validation, proposals, paper creation, and paper cancellation.
- paper.ts: paper ledger operations and risk-reviewed paper placement.
- risk.ts: direct deterministic risk evaluation.
- reconcile.ts: balance comparison plus paper/local reconciliation views.
- system.ts: status, configuration, authentication state, WebSocket snapshots, and withdrawal denial.
- funding.ts: authenticated read-only funding information.
- history.ts and ops.ts: history and operational helpers.

## Response contract

Success:

~~~json
{
  "status": "ok",
  "data": {},
  "fetchedAt": "..."
}
~~~

Failure:

~~~json
{
  "status": "error",
  "code": "ValidationError",
  "message": "...",
  "retryable": false
}
~~~

MCP failures also set isError=true. Agents should branch on stable error codes, not message text.

## Mutation rules

Paper mutations must remain simulation-only.

Live-capable paths must enforce mode, capability, acknowledgement where applicable, server policy, risk approval, idempotency, and audit requirements in executable code. The current application policy denies live execution.

Withdrawal remains denied by design.

## Known limits

The MCP surface is broad, but the current runtime still has integration gaps around durable persistence, full exchange reconciliation, authoritative risk context, and idempotency-aware retry handling.

Do not describe a tool as production-complete solely because its schema or package implementation exists.
