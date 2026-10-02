# Integration tests

Workspace integration coverage lives in per-crate `tests/` targets:

* `indodax-risk/tests/risk_integration.rs`
* `indodax-order/tests/reconciliation.rs`
* `indodax-paper/tests/paper_flow.rs`
* `indodax-mcp/tests/mcp_tools.rs`

Run with `cargo test --workspace --all-targets`.
Live network tests are opt-in and read-only; no credentials are required
for the default suite.
