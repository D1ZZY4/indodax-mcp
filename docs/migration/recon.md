<h1 align="center">Reconstruction of the original repository</h1>

This document records the source repository used as the behavioral reference for the TypeScript rebuild.

Source repository: https://github.com/ibidathoillah/indodax-cli

Reference commit: 5df9b8e, read as a Rust workspace with 33 members and 215 files.

## Original workspace

The original project contained four applications:

- indodax-cli
- indodax-daemon
- indodax-mcp-http
- indodax-mcp-server

It also contained domain and infrastructure crates for core types, configuration, secrets, authentication, transport, rate limits, API access, market/account access, WebSocket handling, orders, trading, risk, portfolio, execution, paper trading, strategies, backtests, alerts, reconciliation, audit, agent intent, MCP, gateway, OAuth, observability, storage, scheduler, events, and tests.

## Important historical behavior

The Rust implementation established several responsibilities that remain reference points:

- Decimal-based financial values.
- Separate authentication and transport layers.
- TAPI v1 and v2 signing separation.
- Explicit order lifecycle and reconciliation concepts.
- Deterministic risk evaluation.
- Shared paper/live execution abstraction.
- Agent intent separated from execution authority.
- Thin MCP tools.
- Dedicated CLI, HTTP, stdio, and daemon interfaces.

## Current TypeScript mapping

The current repository implements these responsibilities across Bun workspace packages such as core, config, secrets, indodax-auth, transport, indodax-client, indodax-market, indodax-account, indodax-orders, indodax-reconciliation, indodax-risk, indodax-execution, indodax-paper, indodax-strategy, indodax-backtest, indodax-portfolio, indodax-alerts, indodax-audit, indodax-websocket, the generic mcp-* packages, and the indodax-mcp application package.

There is no standalone indodax-agent package in the current tree. Agent-facing intent/proposal behavior is represented by trading and MCP contracts instead.

## What was deliberately not preserved as runtime behavior

The Rust project included file-backed persistence and a browser-oriented OAuth flow. The TypeScript rebuild uses a PostgreSQL package as a persistence layer, but the current main application composition remains in-memory. The old OAuth browser flow is not part of the current HTTP gateway.

Likewise, **package presence should not be read as proof** of full runtime integration. Consult the completeness matrix for the current status.

## Historical test coverage

The original repository included unit tests and broader integration coverage around risk, reconciliation, paper execution, MCP surface, and tool envelopes. These tests are preserved here as behavioral references rather than as a claim that the current TypeScript implementation has identical coverage.
