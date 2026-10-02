# ADR-009: Paper and live share the execution contract

* Status: accepted.
* Decision: one `ExecutionBackend` interface with `PaperExecutor`
  and `LiveExecutor`; `ExecutionService` requires an approving
  risk decision for both. Unknown outcomes reconcile before any
  retry; ambiguous cancels become `CANCEL_UNKNOWN`.
* Rationale: paper must exercise the same safety path as live.
* Consequence: no MCP, CLI, strategy, or workbench path reaches
  the exchange adapter without risk approval.
