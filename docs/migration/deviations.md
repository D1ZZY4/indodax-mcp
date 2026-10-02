# Deviations from the build prompt

| Requested | Actual | Reason | Evidence | Impact | Decision |
|---|---|---|---|---|---|
| MCP protocol 2026-07-28 | 2025-11-25 negotiated | Installed SDK 2.2.0 supports max 2025-11-25 | `SUPPORTED_PROTOCOL_VERSIONS` at runtime | None for current clients | Use latest supported, document here |
| TypeScript latest (7.x) | TypeScript 5.9.3 | 7.x is a native preview, ecosystem tooling targets 5.x | npm dist-tags, Vitest/Playwright compat | None | Pin 5.9 line |
| `@vitejs/plugin-react` ^5 | ^6.1.1 | v6 pairs with Vite 8, v5 does not | npm peer metadata | None | Follow peer requirements |
| System PostgreSQL | `embedded-postgres` 17 for dev/test | No server, Docker, or sudo in this environment | missing `psql`, `initdb` | Dev-only; prod uses external PG | Same driver plus schema in both |
| SQLite convenience path | Not used | Real PG binaries available via embedded package | test boots PG 17 | None | No SQLite driver added |
| BullMQ, Redis, OTEL exporters, jose, OpenAPI extras | Not installed | No demonstrated architectural need yet | scheduler covers jobs, pino plus API boundaries cover telemetry | Smaller surface | Install on proven need |
