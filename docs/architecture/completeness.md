# Completeness matrix

Verified against the live workspace. Implemented means behavior exists,
wired means runtime integration exists, tested means a real test
exercises it, end-to-end means it works through its intended path.

| Capability | Implemented | Wired | Tested | End-to-end |
| --- | --- | --- | --- | --- |
| Market REST | yes | yes | yes | yes, live tickers |
| Market WebSocket | snapshot | yes | parse-level | yes, live snapshot |
| Account | yes | yes | validation-level | blocked, key IP not whitelisted |
| Orders | yes | yes | yes | paper yes, live pending creds |
| Trading | yes | yes | yes | paper yes, live denied by policy |
| Risk | yes | yes | yes | yes, pure evaluation |
| Portfolio | yes | yes | yes | paper yes, live pending creds |
| Paper | yes | yes | yes | yes, CLI and MCP flows |
| Live Execution | yes, v2 order API | yes | signing-level | pending IP whitelist |
| Reconciliation | yes | yes | yes | paper vs market yes |
| Audit | yes | yes | yes | yes, file flush verified |
| Alerts | yes | yes | yes | yes, create check cancel |
| Strategy | yes, 2 builtins | yes | yes | yes, pure evaluation |
| Backtest | yes | yes | yes | yes, replay runs |
| Event Bus | yes | publishers wired | yes | daemon consumes market ticks |
| Scheduler | yes | yes, daemon jobs | yes | yes, snapshot and refresh tick |
| Storage | yes, file repos | yes | yes | yes, reload verified |
| Observability | yes | yes | yes | yes, health and metrics |
| Agent Contract | yes | yes | yes | yes, propose flow |
| MCP Tools | 57 tools | yes | yes | yes, protocol verified |
| MCP Resources | 7 | yes | protocol verified | yes |
| MCP Prompts | 5 | yes | protocol verified | yes |
| MCP Safety | yes | yes | yes | withdrawal denied live |
| HTTP Gateway | yes | yes | smoke verified | yes, curl verified |
| OAuth/PKCE | intentionally not ported, see ADR-005 | n/a | n/a | n/a |
| CLI | yes | yes | yes | yes, paper flow live |
| Daemon | yes | yes | smoke verified | yes, boot and persist |
| Security | yes | yes | yes | no secrets in tree |
| Deployment | compose, docker, systemd | n/a | n/a | documented |

Live private paths stay pending until the operator whitelists the
client IP on the exchange API key.
