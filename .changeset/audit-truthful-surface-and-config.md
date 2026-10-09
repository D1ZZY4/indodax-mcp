---
"@indodax-mcp/indodax-mcp": minor
"@indodax-mcp/cli": minor
---

Audit fixes across the MCP surface, the trading gate, and the CLI.

- `indodax_validate_order` no longer silently discards `timeInForce` and `stpMode`: the advertised schema omitted them, so the SDK stripped them before the handler ran and a FOK-on-LIMIT shape error was never raised. Every tool group now declares its input schema once, so this class of drift fails the build.
- Read-only reconcile and risk queries no longer move the trading gate. The reconciliation halt is re-derived on each risk evaluation instead of being cached by a query, so calling a documented read-only tool cannot halt or reopen paper trading.
- Paper MARKET orders are recorded and reported as `MARKET` rather than `LIMIT`, and `shadow` and `development` are rejected explicitly instead of falling through to a paper placement.
- Every tool emits MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), so a harness can gate a call before invoking it instead of parsing prose.
- `indodax_config_status` reports where each credential actually came from (`process-env`, `repo-env-file`, or `absent`) plus a `remedy`, which separates a server process that never received credentials from a genuinely missing key.
- Signed TAPI v2 reads re-sign per retry attempt rather than replaying a signature that can outlive `recvWindow`, and retryable responses release their body.
- The guard checks the environment requirement before credentials, so a live-only tool names live mode as the blocker.
- The CLI rejects unknown actions with exit code 64 and drains shutdown hooks on every exit path, so an unconfigured database pool is no longer abandoned on the paths an operator is most likely to hit.
- Boot-time paper, alert, stop, and deadman mutations are no longer overwritten by a stored snapshot.
- Streamable HTTP builds a fresh MCP server per request, so concurrent and sequential requests no longer fail on a reused instance.