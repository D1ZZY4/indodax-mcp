<h1 align="center">Security</h1>

This project contains authentication, exchange credentials, and execution code. **Treat security defects as potentially financial defects.**

## Scope

The security boundary includes:

- INDODAX API keys and secrets
- authenticated REST requests
- WebSocket tokens
- order placement and cancellation
- risk and capability checks
- reconciliation state
- logs, audit records, and diagnostics
- packaged release artifacts

Live execution stays gated behind environment, credentials, acknowledgement, and risk approval. That reduces exposure, but it does not remove the live adapter from security review.

## Secrets

Primary credential variables are defined in [.env.example](.env.example):

- INDODAX_API_KEY
- INDODAX_API_SECRET

Optional server settings include rate limiting, WebSocket token, database URL, HTTP port, and runtime mode.

**Never commit real credentials.** If a real secret appears in the repository or a build artifact, **revoke or rotate it immediately** at the exchange and remove the exposed material from every affected location.

## Redaction

Secret-bearing values must not appear in:

- application logs,
- MCP responses,
- CLI output,
- test fixtures,
- snapshots,
- issue reports,
- release tarballs.

Keep new fields out of logs unless their exposure is explicitly reviewed.

## Exchange permissions

Use the smallest exchange permission set needed for the task.

- Public market reads need no API credentials.
- Authenticated account and history reads require TAPI v2 credentials.
- Spot trading permission alone does not make this server place live orders, because live placement additionally needs the full gate (environment, acknowledgement, and risk approval).
- Withdrawals are disabled by this server and have no supported grant path.

TAPI v2 transaction permissions require exchange-side IP restrictions. Keep the server network identity aligned with the key configuration.

## Transport

The HTTP gateway binds to 127.0.0.1 by default and uses the MCP Hono adapter. Do not expose it publicly without a deliberate authentication and network-security design.

Stdio inherits the security boundary of the parent process. Run it under the intended operator account and avoid exposing the process stream to untrusted callers.

## Supply chain

- bun.lock is the only repository lockfile.
- CI installs with bun install --frozen-lockfile.
- Only intended packages should be published.
- Review build outputs and package contents before releases.
- Re-run dependency and advisory checks before enabling any live-capable deployment.

A clean dependency audit does not prove that exchange execution is safe. Application-level failure handling still matters.

## Reporting

**Report vulnerabilities privately** to the maintainer before public disclosure.

Include the affected commit or package version, reproduction steps that avoid real funds, expected behavior, observed behavior, and relevant logs with secrets removed.

Use paper mode, mocks, or read-only authenticated calls for reproduction whenever possible.
