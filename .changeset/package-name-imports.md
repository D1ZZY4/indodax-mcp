---
"indodax-mcp": minor
"indodax-mcp-cli": minor
---

Every module is now imported through its package name, including modules inside the same package.

- Source imports resolve as `@indodax-mcp/<package>` for a package entry point and `@indodax-mcp/<package>/<module>` for one of its own modules. There are no relative imports left in `packages/*` or `apps/*`.
- This removes the reason the tree previously carried a hand-written `.js` on every relative import. `tsc` never rewrites a specifier, so an extensionless relative import survived into `dist/` and failed with `ERR_MODULE_NOT_FOUND` the moment Node loaded it. Package-name specifiers resolve through the `exports` map, so no extension is needed and the emitted `dist/` is plain per-file ESM with zero relative specifiers.
- `tsconfig.base.json` carries a `paths` entry per workspace package, so typechecking resolves straight to source and no longer depends on a previously built `dist/`. That removes a latent failure where `packages/mcp-testing` self-referenced its own package name while `turbo typecheck` builds dependencies rather than the package itself, which broke typechecking on a fresh checkout.
- Each `tsconfig.build.json` narrows `paths` to its own package. Declaration emit keeps `rootDir` pointing at its own `src`, while cross-package imports resolve through the already built `dist/*.d.ts` of a dependency.
- Every library `exports` map gained a `./*` subpath so the declarations emitted from subpath imports stay resolvable for consumers.
- The workbench Vite and Vitest configs share one alias for the package name, because Vite does not read TypeScript `paths` on its own.
- Build output is unchanged in shape: per-file `.js` plus a per-file `.d.ts` tree, verified by the existing consumer probe that packs, installs, and runs both published binaries.
