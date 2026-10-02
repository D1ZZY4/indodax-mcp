# Contributing

## Workflow

1. Read the relevant [architecture page](docs/architecture/overview.md) before moving a boundary.
2. Record material decisions in [docs/adr](docs/adr/006-bun-monorepo.md).
3. Keep each authored file at or under 350 lines. 375 is a hard ceiling.
4. Run `bun run format:check`, `bun run lint`, `bunx turbo typecheck`, `bunx turbo test`.
5. Test failure paths, not only happy paths. Paper and live paths need separate tests.
6. Never log secrets. Grep for key material before committing.

## Pull requests

* One logical change per pull request. Split independent concerns so each can be reviewed and reverted alone.
* Describe what changed and why. Link the issue when one exists.
* Keep the tree green: CI runs format, lint, typecheck, test, and build on every push (see [.github/workflows/lint.yml](.github/workflows/lint.yml)).
* Do not weaken a gate to turn red green. Fix the underlying problem.

## Boundaries

* MCP handlers stay thin: validate, guard, call service, serialize.
* Strategy emits signals. Risk decides. Execution performs.
* No live order path bypasses risk or capability checks.
* Storage goes through repository interfaces, not direct Drizzle use.
* Generic `mcp-*` and `core` packages never depend on INDODAX packages.
* Money is `Decimal` from parse time. No float math on balances, prices, fees, or PnL.

## Money safety

* Paper is the default. Never change a default that could route simulation into live execution.
* Withdrawal stays denied. Do not add a grant path without maintainer review.
* Any change touching order placement, cancellation, risk evaluation, or reconciliation needs explicit regression coverage for both allow and deny paths.

## Versioning and releases

* Record user-facing changes with [Changesets](.changeset/README.md) (`bunx changeset`).
* Only `indodax-mcp` and `@indodax-mcp/cli` are publishable. Everything else stays `private: true`.
* Stable releases cut from `v*` tags, beta from the `beta` channel. Templates live in [.github/workflows.disabled](.github/workflows.disabled/release.yml) until enabled.
