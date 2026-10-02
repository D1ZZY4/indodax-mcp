<h1 align="center">ADR-006: Bun monorepo with Turborepo</h1>

- Status: accepted.

## Decision

Use Bun workspaces as the repository package manager and runtime, with Turborepo for task orchestration, Biome for formatting and linting, TypeScript in strict mode, and Vitest for unit and integration tests.

The repository package manager is pinned to Bun 1.4.2.

## Consequences

- bun.lock is the repository lockfile.
- npm, pnpm, and yarn lockfiles should not be introduced.
- Task behavior must be verified against the installed Turborepo version rather than assumed from generic documentation.
