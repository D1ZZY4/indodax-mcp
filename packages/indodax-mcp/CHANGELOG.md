# @indodax-mcp/mcp-app

## 2.0.0

### Major Changes

- **Breaking.** The MCP tool surface is consolidated from 91 tools to 68.
  Twenty-five tool names are retired and their capability is reachable through a
  named replacement, so any harness that calls a removed name must be updated.
  No capability was dropped: every absorbed answer is still returned, under a
  documented argument or field.
  
  Why MAJOR: removing or renaming an MCP tool is classified as breaking in the
  repository's own semver policy. Shipping a smaller surface under the same
  version would leave existing callers silently broken.
  
  ### Retired tools and where their answers moved
  
  | Retired tool | Reached through |
  | --- | --- |
  | `indodax_propose_order` | `indodax_validate_order`, with the new optional `reason` |
  | `indodax_balances` | `indodax_account` with `zeroBalances: false` |
  | `indodax_auth_status` | `indodax_capabilities`, in `credentialsSource` |
  | `indodax_readiness` | `indodax_health` with `readiness: true` |
  | `indodax_audit_events` | `indodax_audit`, renamed, same filters plus two |
  | `indodax_execution_trace` | `indodax_audit` with `correlationId` |
  | `indodax_audit_risk` | `indodax_audit` with `kinds: ["RiskApproved","RiskRejected"]` |
  | `indodax_paper_status`, `indodax_paper_account`, `indodax_paper_orders`, `indodax_paper_snapshots` | `indodax_paper_ledger` with `view` |
  | `indodax_positions`, `indodax_pnl` | `indodax_portfolio` with `view` |
  | `indodax_strategy` | `indodax_strategies` with `id` |
  | `indodax_strategy_validate` | `indodax_strategy_evaluate` with `validateOnly: true` |
  | `indodax_backtest_get`, `indodax_backtest_compare` | `indodax_backtest` with `ids` |
  | `indodax_private_connect`, `indodax_private_disconnect` | `indodax_private_channel` with `action` |
  | `indodax_risk_limits` | `indodax_risk_state`, in `limits` |
  | `indodax_reconciliation_state`, `indodax_reconcile_orders` | `indodax_reconcile_paper` with `scope` |
  | `indodax_reconcile_balances`, `indodax_reconcile_trades`, `indodax_reconcile_full` | `indodax_reconcile_exchange` with `scope` |
  | `indodax_withdraw_history`, `indodax_deposit_history`, `indodax_fiat_history`, `indodax_deposit_address`, `indodax_withdraw_fee` | `indodax_funding` with `kind` |
  
  ### Input narrowing to review before upgrading
  
  - `indodax_private_channel` declares `authRequirement: credentials` because
    connect needs it, so **disconnecting now also requires a configured key**
    where it previously did not. This is the one change that narrows an
    accepted input.
  - `indodax_strategy_evaluate` makes `pair` optional so the validate path can run
    without one. Supplying neither `pair` nor `validateOnly` is refused.
  - `indodax_funding` validates its per-kind arguments in the handler, so a
    missing `coin`, `network`, or `currency` is a `ValidationError` in the
    response envelope rather than a protocol-level schema rejection.
  - `indodax_audit` reports `entries` where the retired trace tool reported
    `trace`, and `approved`/`rejected` counts are present only on a risk-kind
    filter.
  - `indodax_reconcile_exchange` moved from ops to the reconcile surface, and
    `indodax_reconcile_paper` is a new name.
  
  ### Why the reconciliation tools are two and not one
  
  The five reconciliation reads split on a real boundary, so they became two
  tools rather than one. `indodax_reconcile_paper` runs entirely on the in-memory
  ledger and needs no credentials; `indodax_reconcile_exchange` reads the live
  exchange and does. Collapsing them would force a single `authRequirement`,
  which either denies the paper paths on an uncredentialed server or drops
  `credentials` from the metadata and pushes the gate out of the central guard
  into the handler. One slot of tool context is not worth weakening the guard.
  
  ### Unchanged
  
  All 12 resources and all 5 prompts keep their names, URIs, and arguments. The
  HTTP and stdio gateways, the CLI, the daemon, and the workbench are untouched.
  Safety behaviour is unchanged: paper remains the default, live placement still
  needs `APP_ENV=live` plus `TRADE_ENABLED=true`, credentials, per-call
  acknowledgement and a risk ALLOW, and withdrawal remains denied with no
  server-side grant path.

### Patch Changes

- @indodax-mcp/config@2.0.0
  - @indodax-mcp/core@2.0.0
  - @indodax-mcp/db@2.0.0
  - @indodax-mcp/errors@2.0.0
  - @indodax-mcp/events@2.0.0
  - @indodax-mcp/indodax-account@2.0.0
  - @indodax-mcp/indodax-alerts@2.0.0
  - @indodax-mcp/indodax-audit@2.0.0
  - @indodax-mcp/indodax-auth@2.0.0
  - @indodax-mcp/indodax-backtest@2.0.0
  - @indodax-mcp/indodax-client@2.0.0
  - @indodax-mcp/indodax-deadman@2.0.0
  - @indodax-mcp/indodax-execution@2.0.0
  - @indodax-mcp/indodax-market@2.0.0
  - @indodax-mcp/indodax-orders@2.0.0
  - @indodax-mcp/indodax-paper@2.0.0
  - @indodax-mcp/indodax-portfolio@2.0.0
  - @indodax-mcp/indodax-reconciliation@2.0.0
  - @indodax-mcp/indodax-risk@2.0.0
  - @indodax-mcp/indodax-strategy@2.0.0
  - @indodax-mcp/indodax-trading@2.0.0
  - @indodax-mcp/indodax-websocket@2.0.0
  - @indodax-mcp/logging@2.0.0
  - @indodax-mcp/mcp-contracts@2.0.0
  - @indodax-mcp/mcp-core@2.0.0
  - @indodax-mcp/mcp-registry@2.0.0
  - @indodax-mcp/observability@2.0.0
  - @indodax-mcp/scheduler@2.0.0
  - @indodax-mcp/transport@2.0.0
