# Changelog

## Unreleased (TypeScript rebuild)

* Bun workspaces plus Turborepo monorepo with Biome and strict TypeScript.
* Generic MCP infrastructure on official SDK v2: registry, runtime
  (stdio plus Streamable HTTP), contracts, security metadata, testing harness.
* 73 tools with `indodax_` names, 11 resources, 5 prompts.
* Exchange client with zod-validated DTOs, HMAC-SHA256 v2 signing,
  isolated HMAC-SHA512 legacy signing, and multi-bucket rate limits.
* Explicit 11-state execution model with UNKNOWN reconciliation and
  CANCEL_UNKNOWN semantics.
* Deterministic risk engine with fail-closed deadman handling.
* Paper executor sharing the execution contract, Decimal ledger.
* Strategy signals, deterministic backtests with journals, and
  portfolio analytics.
* Market plus private WebSocket with offset recovery, Deadman Switch
  state machine, typed event bus, scheduler, and observability.
* Drizzle PostgreSQL schema (19 tables) with repositories and a
  migration verified against real PostgreSQL 17.
* CLI, daemon, HTTP gateway, and React workbench.
* Playwright E2E over real transports.

## 1.0.1: foundation (Rust)

* Layered workspace scaffold with strongly typed domain model.
* Isolated auth, transport, rate limiting, and exchange API layers.
* Explicit order lifecycle with reconciliation states.
* Deterministic risk engine with machine-readable reasons.
* Paper and live execution backends behind one `ExecutionBackend` trait.
* Agent intent contract separated from execution authority.
* Thin MCP tools with capability-gated mutations.
* File-backed storage, audit trail, event bus, scheduler, daemon lifecycle.
* CLI, MCP stdio server, HTTP gateway, and daemon binaries.
