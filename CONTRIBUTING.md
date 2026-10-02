# Contributing

## Workflow

1. Read the relevant [architecture page](docs/architecture/overview.md) before moving a boundary.
2. Record material decisions in [docs/adr](docs/adr/006-bun-monorepo.md).
3. Keep each file at or under 350 lines. 375 is a hard ceiling.
4. Run `bun run format:check`, `bun run lint`, `bunx turbo typecheck`, `bunx turbo test`.
5. Test failure paths, not only happy paths.
6. Never log secrets. Grep for key material before committing.

## Boundaries

* MCP handlers stay thin: validate, guard, call service, serialize.
* Strategy emits signals. Risk decides. Execution performs.
* No live order path bypasses risk or capability checks.
* Storage goes through repository interfaces, not direct Drizzle use.
* Generic `mcp-*` and `core` packages never depend on INDODAX packages.
