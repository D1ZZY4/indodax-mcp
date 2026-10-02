# ADR-006: Bun monorepo with Turborepo

* Status: accepted.
* Decision: Bun 1.4.2 runtime plus workspaces, Turborepo 2.11 task
  graph, Biome format plus lint, TypeScript 5.9 strict, Vitest tests.
* Rationale: one toolchain for runtime, packages, and scripts;
  dependency-aware build, typecheck, test, and E2E orchestration.
* Consequence: `bun.lock` is the only lockfile; npm, pnpm, and yarn
  are not used.
