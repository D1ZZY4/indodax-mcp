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

- **Paper execution** is the default trading mode.
- Live execution is implemented behind an explicit multi-part gate
  (`APP_ENV=live` plus `TRADE_ENABLED=true`, credentials, per-call
  acknowledgement, and risk ALLOW). The server reports the live gate
  per requirement through `indodax_capabilities`.
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

### Versioning

All 39 workspace packages ship under the `@indodax-mcp` scope and move as **one lockstep version line**. Every manifest carries the same `version` at any commit. The number is the release identity of the whole system, not of an individual package.

#### Why lockstep and not independent versions

`@indodax-mcp/mcp-app` declares a runtime dependency on 25 sibling packages. If `core` were released alone, every consumer would have to upgrade 25 packages to pick up one change, and a stale sibling would produce a resolution error rather than a version skew. Lockstep removes that failure mode and makes "which release am I running" a single question with a single answer.

The cost is deliberate and must be accepted: `@indodax-mcp/secrets` can publish `1.2.0` without a single line of its own changing. **That is correct behavior here, not a mistake.** Do not "fix" it by exempting a package from the version line.

`version-consistency.test.ts` enforces this and fails the build on any drift. `packages/indodax-mcp/src/version.ts` holds `SERVER_VERSION`, asserted against the manifests so a bump that forgets one place fails a test rather than shipping a server that misreports its release.

#### Semver definitions

**MAJOR** (`X.0.0`). A consumer must read the release notes and change their code or configuration.

- Removing or renaming an MCP tool, resource, or prompt
- Removing or renaming any field in a tool response envelope
- Narrowing an input schema: dropping a parameter, tightening an enum, adding a required parameter
- Changing a default risk limit, fee, or rounding rule in a way that alters a computed financial figure
- Changing a safety gate: enabling withdrawal, relaxing a live precondition, or changing which credential a tool demands
- Removing an exported symbol from a library `exports` map
- Raising the minimum Bun or Node version
- Changing the response `code` of an error into a different error class

**MINOR** (`0.Y.0`). Backward compatible. Existing callers keep working unchanged.

- Adding a tool, resource, or prompt
- Adding an optional field to a response
- Adding a new endpoint to the INDODAX adapter
- Adding a new optional environment variable with a working default
- Adding an enum value to an input schema
- Adding a configuration option that defaults to current behavior
- Improving a diagnostic message without changing its `code`

**PATCH** (`0.0.Z`). Internal. No observable contract change.

- Bug fixes that restore documented behavior
- Performance work, refactors, internal renames
- Dependency updates inside the declared ranges
- Documentation, tests, comments
- CI and build configuration

#### The judgment call that matters most

Ask: **would a correct consumer written against the previous version misbehave if it ran against this one?**

- It would crash, silently compute a wrong number, or get a different answer to the same call: **MAJOR**
- It keeps working and can opt into something new: **MINOR**
- Nothing it can observe changes: **PATCH**

For a financial system, **wrong numbers are a MAJOR**, never a MINOR. A rounding change, a fee change, or a freshness-window change alters PnL and equity for an agent that never touched its code. Treat it as breaking even though no schema changed.

#### What is never a version bump

- Adding a changeset file. A changeset is release intent, not a release.
- Editing this document or any other documentation.
- Merging to `main`. `main` is not a release channel.
- Republishing the same code under a different tag.
- Reverting a commit. Revert, then ship it as its own version.

#### Changeset workflow

Every user-visible change to any package gets a changeset, because every package shares a version line.

```bash
bunx changeset
```

The file lists the packages and the bump:

```text
---
"@indodax-mcp/mcp-app": minor
"@indodax-mcp/cli": minor
---
```

Rules for the changeset body:

- Write what a consumer must do, not what a diff did. "Adds `indodax_quote`, read-only pre-order fill estimation" is useful. "Refactored the quote module" is not.
- Name the risk boundary when one moves. "Stop refusal for stale account state no longer retires the stop" matters because it changes protective behavior.
- One changeset per coherent change. Do not bundle unrelated work.
- An empty changeset is acceptable only for a genuinely internal change, and then only with a body explaining why nothing observable moved.

Because of lockstep, name the packages you touched. Changesets propagates the rest.

#### Release procedure

```bash
bunx changeset status          # review the plan first
bun run version-packages      # apply version bumps and CHANGELOG updates
bun run release:dry           # confirm entrypoints and packed contents
```

Then verify before anything reaches the registry:

```bash
bun run format:check
bun run lint
bunx turbo typecheck
bunx turbo test
bunx turbo build
bunx playwright test
bun run verify:consumer
```

Tag and publish:

```bash
git tag v1.2.0
git push origin main --tags
```

`npm publish` rejects a version that already exists. **A version number is spent the moment it is published.** If a release is wrong, fix forward with a new patch or minor. Never plan to reuse a number.

#### Release channels

| Tag | Meaning |
| --- | --- |
| `v1.2.3` | stable, matches the `latest` dist-tag |
| `v1.2.3-beta.1` | prerelease, published under the `beta` dist-tag, never becomes `latest` |
| `v1.2.3-rc.1` | release candidate, same handling as beta |

Prereleases are for validating a change against real traffic. They do not bump the stable line and do not get a CHANGELOG entry under a stable heading.

#### Deprecation policy

- A deprecated tool stays callable for **one MINOR release** and answers with a reason naming its replacement.
- After that MINOR it is removed, which is a MAJOR.
- A deprecated field is reported as absent with a reason, never silently dropped.
- Deprecating a financial parameter (fee, precision, quantity increment) requires a MAJOR and an entry in the changelog's compatibility section.

#### Security and urgent fixes

A security fix ships as the lowest bump that conveys the severity: PATCH for a fix with no consumer-visible contract change, MINOR when a new mitigation flag or response field is added. **Never ship a security fix as a MAJOR.** A MAJOR forces every consumer to read release notes, which is exactly the wrong response to an urgent problem. Say in the changelog body that the bump is intentionally small and why.

#### Registry hygiene

- The token used for publication **cannot delete packages**. npm refuses unpublish for granular tokens that bypass two-factor authentication. Deletion requires a browser session.
- Consequently **treat a publish as irreversible**. Before publishing, confirm `release:dry` and `verify:consumer` both pass.
- Never republish an existing version to fix metadata. Keywords and description changes ship in the next version.

#### Superseded package names

Older names remain live on the registry and are not installable dependencies of anything in this repository:

```text
indodax-mcp, indodax-mcp-cli, @d1zzy4-jethools/indodax-mcp, @d1zzy4-jethools/indodax-mcp-cli
```

Do not document them as install paths. `docs/architecture/overview.md` holds the source-directory-to-package-name mapping, which is not always the identity a reader would guess, since `packages/indodax-mcp` publishes as `@indodax-mcp/mcp-app`.
