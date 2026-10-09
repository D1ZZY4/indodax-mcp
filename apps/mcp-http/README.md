# @indodax-mcp/mcp-http

Streamable HTTP gateway for the INDODAX MCP server. It exposes the same 91
tools, 12 resources, and 5 prompts as the stdio server over HTTP instead of a
pipe.

## Install

```bash
bun add -g @indodax-mcp/mcp-http
```

## Run

```bash
indodax-mcp-http
```

Bind address and port come from the environment, and default to `127.0.0.1`
and `8000`:

```bash
MCP_HOST=127.0.0.1 MCP_PORT=8080 indodax-mcp-http
```

`GET /health` returns the server version, overall health, and persistence state.

## Credentials

`INDODAX_API_KEY` and `INDODAX_API_SECRET` are optional. Without them the
server starts and every read-only tool works against the public API, while
authenticated and live tools refuse with a named reason.

```bash
INDODAX_API_KEY=... INDODAX_API_SECRET=... indodax-mcp-http
```

## Safety

Paper execution is the default. Live placement additionally requires
`APP_ENV=live`, `TRADE_ENABLED=true`, and a per-call acknowledgement. Withdrawal
is denied unconditionally.

## License

SSPL-1.0. See the `LICENSE` file in the repository root.