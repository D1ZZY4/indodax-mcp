# ADR-007: MCP SDK v2 with Hono transport

* Status: accepted.
* Decision: official `@modelcontextprotocol/*` 2.x family with
  `McpServer.registerTool`, stdio via `serveStdio`, HTTP via
  `createMcpHandler` plus `createMcpHonoApp` with localhost
  validation. Negotiated protocol is 2025-11-25, the maximum the
  installed SDK supports; 2026-07-28 is not present in SDK 2.2.0.
* Rationale: official wire behavior instead of a custom protocol.
* Consequence: Hono adapter stays thin; domain logic lives in
  services behind the registry.
