# Dependency compatibility (verified 2026-10-02, Bun 1.4.2)

All versions below are npm `latest` dist-tags confirmed via registry
metadata, plus Context7/official doc checks where noted.

## MCP SDK v2 (verified via Context7 typescript-sdk docs)

- `@modelcontextprotocol/server` 2.2.0, deps `zod ^4.2.0`,
  `@modelcontextprotocol/core 2.2.0`. Exports `McpServer`,
  `registerTool(name, {description, inputSchema}, handler)`,
  `serveStdio`, `createMcpHandler`. No v1 `Server` class usage.
- `@modelcontextprotocol/core` 2.2.0, deps `zod ^4.2.0`.
- `@modelcontextprotocol/client` 2.2.0. Client with
  `versionNegotiation: {mode: auto}`, `callTool`, `getPrompt`.
- `@modelcontextprotocol/hono` 2.0.1, peers `hono ^4.11.4`,
  `@modelcontextprotocol/server ^2.1.0`. Exports
  `createMcpHonoApp` (localhost host/origin validation by default)
  used as `app.all('/mcp', c => handler.fetch(c.req.raw))`.
- Zod must be v4 line (4.6.5 latest). SDK examples import `zod/v4`.

## Web/API

- `hono` 4.13.12 satisfies hono-adapter peer.
- `@hono/standard-validator` 0.4.0.
- `postgres` 3.4.9 (Postgres.js driver for Drizzle).
- `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11.

## Language/toolchain

- `typescript` pinned at 5.9 line (latest registry shows 7.0.2
  native preview; 5.9 chosen for ecosystem stability with SDK types
  and Vitest/Playwright tooling).
- `@biomejs/biome` 2.5.15 for format plus lint (no ESLint/Prettier).
- `turbo` 2.11.7 for task graph.
- `vitest` 5.0.3 plus `@vitest/coverage-v8`, `fast-check` 4.10.2,
  `msw` 3.0.1, `@playwright/test` 1.63.0.

## App libs

- `citty` 0.2.2, `@clack/prompts` (interactive CLI).
- `pino` 10.3.1 structured logging.
- `decimal.js` 10.6.0 financial math.
- `@t3-oss/env-core` 0.13.11 plus zod central env parsing.
- `react`/`react-dom` 19.3.0, `vite` 8.3.2, `tailwindcss` v4 line,
  `@tanstack/react-query` (version resolved at install).

## Conditional (install only on demonstrated need)

- `jose` 6.2.12, `@hono/zod-openapi`, `@scalar/hono-api-reference`,
  `bullmq` 6.3.11, `ioredis` 6.0.0, `@opentelemetry/api` 1.9.1.

## Environment deviations

- No system PostgreSQL, no Docker, no passwordless sudo in this
  environment. Local/dev/test databases run on real PostgreSQL
  binaries via `embedded-postgres` (MIT), reached through the same
  `postgres.js` driver and Drizzle schema as production. Production
  target stays external PostgreSQL via `DATABASE_URL`. Recorded here
  per deviation policy; see `risk-register.md`.
- No `mcp-server-time` style Node-only assumptions; Bun-native
  fetch, Web Crypto, WebSocket, and AbortSignal are used first.
