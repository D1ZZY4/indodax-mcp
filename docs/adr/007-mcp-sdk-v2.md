<h1 align="center">ADR-007: MCP SDK v2 with Hono transport</h1>

- Status: accepted.

## Decision

Use the official MCP SDK v2 family for server and client behavior.

The current repository uses:

- @modelcontextprotocol/server 2.2.0
- @modelcontextprotocol/core 2.2.0
- @modelcontextprotocol/client 2.2.0
- @modelcontextprotocol/hono 2.0.1

The current environment negotiates **MCP protocol `2025-11-25`**.

HTTP uses the official Hono adapter and binds locally by default.

## Consequence

Do not recreate MCP wire behavior inside domain packages. When SDK exports or protocol versions change, verify them against the installed dependency and update the compatibility record.
