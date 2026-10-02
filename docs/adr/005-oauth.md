<h1 align="center">ADR-005: HTTP authentication boundary</h1>

- Status: accepted.
- Current location: apps/mcp-http and mcp-runtime.

## Decision

Do not port the original Rust browser OAuth Authorization Code + PKCE flow into the current local HTTP gateway.

The current gateway is a localhost-oriented MCP transport. It is intentionally kept small rather than acting as a general-purpose authorization server.

## Consequence

A future multi-user deployment needs a separate authentication and authorization design. The current local bridge must not be exposed publicly and treated as though it already provides a complete identity boundary.

See [Security](../../SECURITY.md) for current transport guidance.
