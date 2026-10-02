# Changelog

## Unreleased

Current TypeScript/Bun rebuild includes:

- Bun workspaces with Turborepo, Biome, strict TypeScript, and Vitest.
- Official MCP SDK v2 infrastructure with shared registry, stdio, Streamable HTTP, contracts, and test harnesses.
- 73 MCP tools, 11 resources, and 5 prompts.
- INDODAX public REST, TAPI v2 signing, authenticated account/history reads, and WebSocket protocol primitives.
- Explicit order lifecycle and deterministic risk evaluation.
- Paper execution through the shared execution service.
- Strategy evaluation, deterministic backtests, portfolio analytics, alerts, audit, scheduler, events, observability, and operational tooling.
- PostgreSQL schema, migrations, and repository implementations.
- CLI, daemon, HTTP gateway, and React workbench.
- Automated test/build tooling plus consumer verification utilities.

### Current capability boundary

The main application composition is paper-only. Live order and cancel adapters exist but are disabled by application policy. PostgreSQL is not yet the main runtime source of truth, and the MCP reconciliation surface is not yet a full exchange-state reconciliation workflow.

## 1.0.1: foundation (Rust)

The original Rust release established the behavioral reference for the current rebuild: layered exchange access, typed financial models, explicit order lifecycle, deterministic risk, paper/live execution abstraction, agent intent boundaries, MCP tools, storage, events, scheduling, and operational processes.
