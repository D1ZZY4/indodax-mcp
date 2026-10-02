# Security

This codebase moves real money when live mode is enabled. Review accordingly.

## Secrets

Never commit real credentials. The required env contract is defined in [.env.example](.env.example): `INDODAX_API_KEY` and `INDODAX_API_SECRET` for private access, plus optional `INDODAX_RATE_LIMIT`, `INDODAX_WS_TOKEN`, `APP_ENV`, `TRADE_ENABLED`, and `WITHDRAW_ENABLED`. Nothing else belongs in `.env`. Server secrets never reach Workbench browser code; environment parsing is centralized in [config](packages/config/src/index.ts).

> [!IMPORTANT]
> `.env` is git-ignored. Only `.env.example` is tracked. If a real secret ever lands in a commit, rotate the key on the exchange dashboard immediately; removing it in a later commit does not remove it from history.

## Redaction

`SecretValue` masks values, pino loggers redact secret paths, and audit entries carry ids and reasons, never key material. MCP responses, CLI output, fixtures, and build artifacts never contain secrets.

## Permissions

* `READ`, `PAPER`: safe reads and simulation.
* `TRADE`: mutations gated by risk and capability, disabled by default. Live additionally needs `APP_ENV=live`, `TRADE_ENABLED=true`, key trading permission, whitelisted client IP, and per-call acknowledgement.
* `WITHDRAW`: disabled by default and by design. This server holds no grant path for it.

Live trading needs explicit live mode plus the matching capability plus passing startup checks. Paper mode is the default and cannot spend real funds.

## Transports

HTTP binds 127.0.0.1 with the official Hono adapter, which enforces localhost host and origin validation. Do not disable these checks for convenience. Stdio mode inherits the spawning host's process boundary; run it under the operator's own user.

## Dependency and supply chain

* `bun.lock` is the only lockfile. Install with `bun install --frozen-lockfile` in CI and release jobs.
* Only `indodax-mcp` and `@indodax-mcp/cli` publish to npm, as bundled `dist/` output. Workspace sources and secrets never ship in tarballs (see `files: ["dist/"]` plus `verify:consumer`).
* Audit with `bun audit` before releases. The known dev-only esbuild advisory is accepted and documented; re-evaluate when the advisory or version changes.

## Reporting

Report suspected vulnerabilities privately to the maintainer before opening a public issue. Include affected version or commit, reproduction steps that avoid real funds (paper mode, mocks, or read-only live calls), and the observed versus expected behavior.
