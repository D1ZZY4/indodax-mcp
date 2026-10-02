<h1 align="center">Contributing</h1>

Thank you for contributing to infrastructure that can eventually interact with financial accounts. **Review changes as if failure has a cost.**

## Development workflow

1. Read the relevant architecture page before changing a package boundary.
2. Check migration notes and ADRs before changing an established decision.
3. Keep authored files at or under **350 lines**. **375 lines is the hard ceiling**.
4. Use Bun and the repository lockfile. Do not introduce npm, pnpm, or yarn lockfiles.
5. Keep financial calculations in Decimal form.
6. Add regression coverage for success and denial paths when changing trading, risk, execution, or reconciliation.
7. Never commit credentials, private API payloads, or secrets copied from production.

## Before opening a pull request

~~~bash
bun run format:check
bun run lint
bunx turbo typecheck
bunx turbo test
bunx turbo build
bunx playwright test
~~~

Then run:

~~~bash
bun run verify
~~~

**Do not weaken a gate to turn red green.** Fix the underlying problem or document an explicit deviation.

## Pull requests

Keep one logical change per pull request whenever practical. A PR should explain:

- what changed,
- why the change is needed,
- which package boundaries are affected,
- how the change was tested,
- whether the behavior is paper-only, read-only live, or changes a live-capable path.

For broad repository changes, include a line-count report using a consistent command such as:

~~~bash
wc -l path/to/file.ts path/to/other-file.md
~~~

## Architecture rules

- MCP handlers validate, guard, call, and serialize.
- Generic MCP and core infrastructure must not import INDODAX domain packages.
- Strategy emits signals; risk evaluates; execution performs.
- Domain code uses repository interfaces rather than importing Drizzle connections directly.
- Exchange JSON is normalized at the adapter boundary.
- No live-capable path may bypass risk review or server policy.
- Withdrawal remains denied until a separately reviewed security design exists.

## Financial safety

Paper is the default supported execution mode.

**Never use real credentials in tests** that can place or cancel orders. Prefer paper mode, deterministic mocks, and read-only authenticated calls.

Changes affecting live order placement, cancellation, idempotency, retry behavior, risk context, reconciliation, WebSocket state, or Deadman behavior require coverage for ambiguous and failure states.

## Database changes

Schema changes belong in packages/db/src/schema.ts.

Generate and review migrations before applying them:

~~~bash
bun --filter @indodax-mcp/db db:generate
bun --filter @indodax-mcp/db db:migrate
~~~

The database package is not yet the runtime source of truth for the main MCP composition. Do not document persistence as complete until application wiring has been updated and tested.

## Releases

Use Changesets for user-visible package changes:

~~~bash
bunx changeset
bun run version-packages
bun run release:dry
~~~

Only the intended publishable packages are released. Keep publication metadata aligned with [.changeset/README.md](.changeset/README.md).

Historical release workflows remain under [.github/workflows.disabled](.github/workflows.disabled/release.yml) until explicitly enabled.
