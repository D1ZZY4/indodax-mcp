<h1 align="center">Audit tools</h1>

Read-only views over the in-memory audit trail (Postgres mirror when
configured). Entries never carry secrets.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_audit` | `limit`? int 1-100 default 20, `kind`? string, `kinds`? string array, `correlationId`? string | `{ total, filtered, count, correlationId, kinds, entries, approved?, rejected?, summary }` | The whole audit surface in one read. Entries are newest last. |

## Arguments

- `limit` caps how many of the most recent matching entries come back.
- `kind` filters on one audit kind, for example `PaperReset`.
- `kinds` filters on several at once.
- `correlationId` returns every entry for one decision, in order. That is the
  incident-review path.

## What replaced the removed tools

Three reads collapsed into this one because all three were `app.audit` with a
different filter applied.

| Removed | Now |
| --- | --- |
| retired `indodax_audit_events` | `indodax_audit`. Same name, plus the `kinds` and `correlationId` arguments. |
| retired `indodax_execution_trace` | `indodax_audit` with `correlationId`. The field is named `entries` now, where the trace tool called it `trace`. |
| retired `indodax_audit_risk` | `indodax_audit` with `kinds: ["RiskApproved", "RiskRejected"]`. That filter also adds the `approved` and `rejected` counts, which are absent on any other call so an ordinary read does not carry counts that would be zero by definition. |

An empty trail is normal activity state, not a failure. The response says so in
`warnings` rather than leaving a zero count to be interpreted, and a
`correlationId` with no entries names the id it searched for.

Entry shape: `{ eventId, timestamp, correlationId, sessionId?, agentId?,
symbol?, kind, decision?, result?, reason? }`. Event ids are unique across
restarts. Kinds include `AgentIntentCreated`, `RiskApproved`, `RiskRejected`,
`PaperReset`, strategy/backtest runs, and Deadman changes.

Related: `audit://recent` resource, `indodax_incident_review` prompt.