# ADR-001: Workspace boundaries

> Historical record from the Rust workspace. Package names below refer
> to the original crates; see [Rust to TypeScript](../migration/rust-to-typescript.md) for current locations.

* Status: accepted.
* Decision: split exchange I/O (`auth`, `transport`, `rate-limit`, `api`,
  `websocket`) from domain (`core`, `order`, `risk`, `portfolio`) and from
  interfaces (`mcp`, `gateway`, `cli`, `daemon`).
* Consequence: risk and execution stay callable without MCP or network.
