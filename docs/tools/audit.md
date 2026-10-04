<h1 align="center">Audit tools</h1>

Read-only views over the in-memory audit trail (Postgres mirror when
configured). Entries never carry secrets.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_audit_events` | `limit` int 1-100 default 20, `kind`? filter, `correlationId`? filter | Entries newest last | Use the filters instead of scrolling. |
| `indodax_execution_trace` | `correlationId` required | Every entry for one correlation id, in order | Incident review path. |
| `indodax_audit_risk` | `limit`? default 20 | `RiskApproved`/`RiskRejected` entries | Risk decision feed. |

Entry shape: `{ eventId, timestamp, correlationId, sessionId?, agentId?,
symbol?, kind, decision?, result?, reason? }`. Event ids are unique across
restarts. Kinds include `AgentIntentCreated`, `RiskApproved`, `RiskRejected`,
`PaperReset`, strategy/backtest runs, and Deadman changes.

Related: `audit://recent` resource, `indodax_incident_review` prompt.
