<h1 align="center">Architecture overview</h1>

The repository separates exchange protocol handling, financial domain logic, application orchestration, and MCP/CLI interfaces.

## Runtime direction

```mermaid
flowchart TD
    subgraph Interface["Interface"]
        direction LR
        MCP["MCP"] & CLI["CLI"] & Daemon["Daemon"]
    end
    subgraph App["Application"]
        direction LR
        Intent["Agent intent / TradingService"] --> Risk["RiskEngine"]
    end
    subgraph Exec["Execution"]
        direction LR
        Svc["ExecutionService"] --> Paper["PaperBackend"]
        Svc --> Live["LiveBackend"]
    end
    Interface --> App --> Exec --> API["Indodax API"]
```

The main composition defaults to paper execution with in-memory application state. With `APP_ENV=live` plus credentials, acknowledgement, and risk approval, the live backend executes through the same risk-guarded path.

## Package layers

### Generic foundation

- `@indodax-mcp/core`: domain types, Decimal helpers, symbols, order validation, capabilities, execution modes, and risk types.
- `@indodax-mcp/errors`: typed application and exchange errors.
- `@indodax-mcp/mcp-core`: MCP SDK server construction and dispatch.
- `@indodax-mcp/mcp-contracts`: metadata schemas for tools, resources, and prompts.
- `@indodax-mcp/mcp-registry`: registry for MCP surface definitions.
- `@indodax-mcp/mcp-runtime`: stdio and HTTP transport adapters.
- `@indodax-mcp/mcp-testing`: in-memory, stdio, and HTTP test harnesses.
- `@indodax-mcp/transport`: HTTP retry and rate-limiting primitives.
- `@indodax-mcp/storage`: repository interfaces and in-memory implementation.
- `@indodax-mcp/db`: PostgreSQL schema, migrations, and Drizzle repositories.

### Exchange and domain

- `@indodax-mcp/indodax-auth`: TAPI v2 and legacy signing plus private WebSocket token signing.
- `@indodax-mcp/indodax-client`: public REST adapter.
- `@indodax-mcp/indodax-market`: normalized market access and cache.
- `@indodax-mcp/indodax-account`: authenticated account and history reads.
- `@indodax-mcp/indodax-orders`: order record and lifecycle state machine.
- `@indodax-mcp/indodax-reconciliation`: local versus exchange reconciliation primitives.
- `@indodax-mcp/indodax-risk`: deterministic risk engine.
- `@indodax-mcp/indodax-execution`: paper/live execution interface and live adapter.
- `@indodax-mcp/indodax-paper`: paper ledger and simulator.
- `@indodax-mcp/indodax-trading`: trade intent, proposal, validation, and risk review.
- `@indodax-mcp/indodax-portfolio`: portfolio calculations.
- `@indodax-mcp/indodax-strategy`: signal generation.
- `@indodax-mcp/indodax-backtest`: deterministic replay and reports.
- `@indodax-mcp/indodax-alerts`: in-memory alert store and condition evaluation.
- `@indodax-mcp/indodax-audit`: in-memory audit trail.
- `@indodax-mcp/indodax-deadman`: Deadman state machine.
- `@indodax-mcp/indodax-websocket`: market/private socket protocol and managed connections.

### Application and operations

- `@indodax-mcp/mcp-app`: application composition, tools, resources, and prompts.
- `@indodax-mcp/observability`: health and counters.
- `@indodax-mcp/events`: typed event bus.
- `@indodax-mcp/scheduler`: interval jobs and shutdown controls.
- `@indodax-mcp/logging`: structured logging.
- `@indodax-mcp/config`: typed environment parsing.
- `@indodax-mcp/secrets`: secret wrappers.

The application package is composed by the CLI, stdio server, HTTP gateway, daemon, and workbench.

### Published names

Every package publishes under the `@indodax-mcp` scope at 2.0.0, and all 39 move on one lockstep version line. The source directory and the package name differ in one place:

| Source directory | Published package |
| --- | --- |
| `packages/indodax-mcp` | `@indodax-mcp/mcp-app` |
| `apps/mcp-stdio` | `@indodax-mcp/indodax-mcp` |
| `apps/cli` | `@indodax-mcp/cli` |
| `apps/daemon` | `@indodax-mcp/daemon` |
| `apps/mcp-http` | `@indodax-mcp/mcp-http` |
| `apps/mcp-workbench` | `@indodax-mcp/mcp-workbench` |

`packages/indodax-mcp` is not `@indodax-mcp/indodax-mcp` because `apps/mcp-stdio` already owns that name, and a workspace cannot hold two manifests with one name.

## Boundary rules

- Generic infrastructure does not depend on INDODAX-specific packages.
- Exchange protocol details stay in adapters.
- Strategy code does not place orders.
- MCP handlers do not sign requests or implement exchange protocol.
- Financial math uses Decimal.
- Database access belongs behind repositories.

When code violates these rules, **update the boundary** rather than adding another exception.

## Current integration limits

Persistence exists as a database package but is not the source of truth for the current application composition. The MCP reconciliation surface is also not yet a complete exchange-state reconciliation workflow.

See [Completeness](completeness.md) for the current implementation status.
