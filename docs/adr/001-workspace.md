<h1 align="center">ADR-001: Workspace boundaries</h1>

- Status: historical.
- Origin: original Rust workspace.

## Decision

Separate exchange I/O, domain logic, and interfaces so **business rules do not depend directly** on MCP, CLI, or network transport.

## Current location

The TypeScript rebuild applies the same boundary principle through Bun workspace packages:

- Exchange and protocol concerns: indodax-auth, transport, indodax-client, indodax-account, indodax-websocket.
- Domain and execution concerns: core, indodax-orders, indodax-risk, indodax-execution, indodax-paper, indodax-trading.
- MCP infrastructure: mcp-core, mcp-contracts, mcp-registry, mcp-runtime, mcp-testing.
- Application composition: indodax-mcp and apps/*.

The Rust crate names in this ADR are historical and should not be used as current import paths.
