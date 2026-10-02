# Security

This codebase moves real money when live mode is enabled. Review
accordingly.

## Secrets

Never commit real credentials. The required env contract is defined in
`.env.example`: `INDODAX_API_KEY` and `INDODAX_API_SECRET` for private
access, plus optional `INDODAX_RATE_LIMIT` and `INDODAX_WS_TOKEN`.
Nothing else belongs in `.env`.

## Redaction

`SecretValue` masks on both `Display` and `Debug`, so secrets stay out
of logs, errors, debug output, audit records, MCP responses, CLI output,
and test snapshots. Audit entries carry ids and reasons, never key material.

## Permissions

* `market.read`, `account.read`: reads. No state changes.
* `trade.place`, `trade.cancel`: mutations gated by risk and capability.
* `funding.withdraw`: disabled by default, granted separately or not at all.

Live trading needs explicit `live` execution mode plus the matching
capability. Paper mode is the default and cannot spend real funds.

## Reporting

Report suspected vulnerabilities privately to the maintainer before
opening a public issue.
