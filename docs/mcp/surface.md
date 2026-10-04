<h1 align="center">MCP surface</h1>

The current server exposes a shared registry through stdio and Streamable HTTP.

## Transports

- apps/mcp-stdio: stdio transport for MCP hosts such as OpenCode.
- apps/mcp-http: Streamable HTTP gateway bound to localhost, default port 8000.
- Both use buildIndodaxServer(), so tool, resource, and prompt registrations come from the same application composition.

The current SDK environment negotiates MCP protocol 2025-11-25.

## Surface

The registry currently contains **82 tools**, **12 resources**, and **5 prompts**.

| Area | Current role |
| --- | --- |
| Market | Public market data |
| Account | Authenticated account and order reads |
| Orders | Validation, proposal, paper placement, live placement, cancellation, and timeInForce/STP options |
| Stops | Server-side emulated stop orders: create, list, cancel, and trigger checks |
| Portfolio | Paper exposure, positions, and PnL views |
| Risk | Limits, state, and hypothetical evaluation |
| Paper | Virtual ledger, fills, cancellation, and reset |
| Strategy | Built-in strategy discovery and evaluation |
| Backtest | Deterministic replay and in-process stored results |
| Alerts | Alert definitions and condition checks |
| Reconciliation | Balance comparison, paper consistency, and full exchange checks |
| Audit | Recent audit records and risk decisions |
| System | Health, readiness, configuration, runtime, auth, and withdrawal denial |
| Funding | Authenticated read-only funding information |
| History | Exchange history and paper-fill helpers |
| Operations | Exposure, WebSocket state/reconnect helpers, private channel connect, Deadman state, and stop trigger checks |
| Docs | Agent-harness guide pages with full parameters, served by indodax_docs |

## Resources

The 12 resources cover market, pair metadata, account, open orders, portfolio, risk, reconciliation, audit, alerts, system health, WebSocket state, and capabilities.

Resource handlers mostly expose application-local state. They are not durable database views because the current main composition does not use PostgreSQL as its runtime source of truth.

## Prompts

Five prompts guide market, portfolio, order, strategy, and incident review. Prompt handlers return instructions for the calling agent; they do not directly place orders.

## Safety boundary

Tool metadata declares capability, risk class, environment, authentication, destructiveness, idempotency class, and audit class.

A central guard enforces authentication and environment for every tool. Capability, risk, and audit enforcement stays in handlers and services.

For new mutation tools, metadata and executable guards are **both required**. **Never treat metadata alone as a security control.**
