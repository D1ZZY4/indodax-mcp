# Security

This codebase moves real money when live mode is enabled. Review
accordingly.

## Secrets

Never commit real credentials. The required env contract is defined in
`.env.example`: `INDODAX_API_KEY` and `INDODAX_API_SECRET` for private
access, plus optional `INDODAX_RATE_LIMIT` and `INDODAX_WS_TOKEN`.
Nothing else belongs in `.env`. Server secrets never reach Workbench
browser code; environment parsing is centralized.

## Redaction

`SecretValue` masks values, pino loggers redact secret paths, and
audit entries carry ids and reasons, never key material. MCP responses,
CLI output, and fixtures never contain secrets.

## Permissions

* `READ`, `PAPER`: safe reads and simulation.
* `TRADE`: mutations gated by risk and capability, disabled by default.
* `WITHDRAW`: disabled by default, granted separately or not at all.

Live trading needs explicit live mode plus the matching capability
plus passing startup checks. Paper mode is the default and cannot
spend real funds.

## Transports

HTTP binds 127.0.0.1 with the official Hono adapter, which enforces
localhost host and origin validation. Do not disable these checks for
convenience.

## Reporting

Report suspected vulnerabilities privately to the maintainer before
opening a public issue.
