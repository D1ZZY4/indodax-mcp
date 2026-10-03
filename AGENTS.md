<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Project guidance

This repository is a Bun monorepo. Resolve the installed toolchain from the repository instead of assuming globally installed versions.

### Architecture boundaries

- core, errors, mcp-*, transport, storage, and related generic infrastructure must remain independent of INDODAX-specific packages.
- INDODAX adapters own exchange I/O and protocol normalization.
- Application composition belongs in packages/indodax-mcp.
- MCP handlers stay thin: validate input, enforce the operation-specific guard, call a service, serialize the result.
- Money, price, quantity, fees, and PnL use Decimal at the financial boundary.
- Strategy code emits signals. It does not place orders.

### Safety boundaries

- **Paper execution** is the current supported trading mode.
- Live execution is implemented but **disabled by the current server policy**.
- Withdrawal is **denied by design**.
- **Never place real orders** for validation, tests, examples, or verification.
- Use mocks, paper state, and read-only exchange calls for verification.
- Treat an ambiguous live exchange response as **unknown**. **Do not retry blindly**.

### Documentation truthfulness

Architecture documentation must distinguish:

1. implemented code,
2. runtime wiring,
3. automated coverage,
4. end-to-end verification,
5. planned or blocked behavior.

**Do not describe a package-level capability as production-ready** merely because its types, schema, or interface exists.

### Quality gates

Before finishing repository changes:

~~~bash
bun run format:check
bun run lint
bunx turbo typecheck
bunx turbo test
bunx turbo build
bunx playwright test
~~~

For the combined repository gate:

~~~bash
bun run verify
~~~

### File size

Keep authored files at or under **350 lines**. **375 lines is the hard ceiling**. Do not split files mechanically just to satisfy the limit. Measure authored files with a consistent method such as `wc -l` and report path, line count, target, and status for broad changes.

**No em dash characters** in repository output.
