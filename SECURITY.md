# Security

This is financial infrastructure. Treat it accordingly.

## Secrets

Never commit real credentials. Required env contract lives in
`.env.example`. Only `INDODAX_API_KEY`, `INDODAX_API_SECRET`,
and the optional `INDODAX_RATE_LIMIT` / `INDODAX_WS_TOKEN` belong there.

## Redaction

Secrets are redacted from logs, errors, debug output, audit records,
MCP responses, CLI output, and test snapshots. `SecretValue` masks on
`Display` and `Debug`.

## Permissions

* `market.read` and `account.read` are safe reads.
* `trade.place` / `trade.cancel` are controlled mutations.
* `funding.withdraw` is disabled by default and separately permissioned.

Live trading requires explicit `live` execution mode plus the matching
capability. Paper mode is the default.

## Reporting

Report suspected vulnerabilities privately to the maintainer before
opening a public issue.
