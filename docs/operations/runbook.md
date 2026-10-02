# Operations

## Checks

`scripts/check.sh` runs fmt, check, test, and clippy for the workspace.
CI runs the same script on every push.

## Health

Query `system_health`. Four states: healthy, degraded, unhealthy,
halted. Halted means risk or reconciliation stopped trading; do not
trust order tools until health recovers. `system_mode` reports the
active execution mode.

## Metrics

Counters cover submitted, filled, and rejected orders, risk rejections,
exchange errors, WebSocket reconnects, reconciliation failures, and MCP
requests with failures. Read them through `system` tooling or the
observability crate in-process.

## Live credential rotation

Keys live in process env (`INDODAX_API_KEY`,
`INDODAX_API_SECRET`), never in the repo. After rotating a key on the
exchange dashboard, restart the MCP server, HTTP gateway, and daemon so
each process picks up the new values. Re-run `auth_status` to confirm
the new credentials are configured, then `auth_test` equivalent
(`account_info`) before enabling any trading.
