<h1 align="center">Changelog</h1>

## Unreleased

Current TypeScript/Bun rebuild includes:

- Bun workspaces with Turborepo, Biome, strict TypeScript, and Vitest.
- Official MCP SDK v2 infrastructure with shared registry, stdio, Streamable HTTP, contracts, and test harnesses.
- **88 MCP tools**, **12 resources**, and **5 prompts**.
- INDODAX public REST, TAPI v2 signing, authenticated account/history reads, and WebSocket protocol primitives.
- Explicit order lifecycle and deterministic risk evaluation.
- Paper execution through the shared execution service.
- Live execution gated by `APP_ENV=live` plus `TRADE_ENABLED=true`, credentials, acknowledgement, and risk approval.
- Server-side emulated stops with trigger checks, plus timeInForce and self-trade prevention passthrough.
- Live private channel over the official WebSocket dialect with token fetch.
- Strategy evaluation, deterministic backtests, portfolio analytics, alerts, audit, scheduler, events, observability, and operational tooling.
- PostgreSQL schema, migrations, and repository implementations.
- CLI, daemon, HTTP gateway, and React workbench.
- Automated test/build tooling plus consumer verification utilities.

### Current capability boundary

The main application composition defaults to **paper**. Live order and cancel run through the risk-guarded path when `APP_ENV=live` plus `TRADE_ENABLED=true` with credentials and acknowledgement. PostgreSQL mirrors paper, audit, alerts, and stops when configured but is **not yet the main runtime source of truth**, and the MCP reconciliation surface is **not yet a full exchange-state reconciliation workflow**.

## 1.0.1: foundation (Rust)

The original Rust release established the behavioral reference for the current rebuild: layered exchange access, typed financial models, explicit order lifecycle, deterministic risk, paper/live execution abstraction, agent intent boundaries, MCP tools, storage, events, scheduling, and operational processes.
