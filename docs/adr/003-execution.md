# ADR-003: Paper and live backends

* Status: accepted.
* Decision: one `ExecutionBackend` trait with `PaperBackend` and
  `LiveBackend` implementations sharing `ExecutionRequest` and risk types.
* Consequence: paper behavior exercises the same contracts as live,
  without duplicating risk or order logic.
