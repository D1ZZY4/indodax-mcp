# Completeness matrix

Verified against the live workspace. Implemented means behavior exists,
wired means runtime integration exists, tested means a real test
exercises it, end-to-end means it works through its intended path.

| Capability | Implemented | Wired | Tested | End-to-end |
| --- | --- | --- | --- | --- |
| Market REST | yes | yes | yes | yes, live tickers |
| Market WebSocket | snapshot plus managed socket | yes | protocol-level | one-shot live verified |
| Account | yes | yes | validation-level | blocked, key IP not whitelisted |
| Orders | yes | yes | yes | paper yes, live locked by policy |
| Trading | yes | yes | yes | paper yes, live denied by policy |
| Risk | yes | yes | yes | yes, pure evaluation |
| Portfolio | yes | yes | yes | paper yes, live pending creds |
| Paper | yes | yes | yes | yes, CLI, MCP, and workbench flows |
| Live Execution | yes, v2 order API | yes | signing-level | locked, IP pending |
| Reconciliation | yes | yes | yes | paper vs market yes |
| Audit | yes | yes | yes | yes, in-memory plus Drizzle repo |
| Alerts | yes | yes | yes | yes, create check cancel |
| Strategy | yes, 2 builtins | yes | yes | yes, pure evaluation |
| Backtest | yes, stored runs | yes | yes | yes, replay plus journal |
| Event Bus | yes, typed | daemon wiring | yes | CLI and daemon paths |
| Scheduler | yes | yes, daemon jobs | yes | yes |
| Storage | yes, Drizzle PG | yes | yes, real PG 17 | yes, migrate plus repos |
| Observability | yes | yes | yes | yes, health and counters |
| Agent Contract | yes | yes | yes | yes, propose flow |
| MCP Tools | 73 tools | yes | yes | yes, protocol verified |
| MCP Resources | 11 | yes | protocol verified | yes |
| MCP Prompts | 5 | yes | protocol verified | yes |
| MCP Safety | yes | yes | yes | withdrawal denied live |
| HTTP Gateway | yes, Hono adapter | yes | yes, E2E | yes |
| Deadman | yes, state machine | yes | yes | paper simulated |
| CLI | yes | yes | yes, subprocess | yes, paper flow live |
| Daemon | yes | yes | yes, lifecycle | yes, boot and persist |
| Workbench | yes, 3 pages | yes | render plus E2E | yes |
| Security | yes | yes | yes | no secrets in tree |
| Deployment | compose, docker, systemd | n/a | n/a | documented |

Live private paths stay pending until the operator whitelists the
client IP on the exchange API key.
