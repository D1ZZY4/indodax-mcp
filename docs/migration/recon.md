# Recon: existing repository map

Source: full read of `/home/dizzy/Projects/MCPs/indodax-mcp` at commit
`5df9b8e` (215 files, Rust workspace, 33 members, version 1.0.1).

## Workspace members

Apps (4): `indodax-cli` (binary `indodax`, 9 subcommands), `indodax-daemon`
(bootstrap plus scheduler plus graceful shutdown), `indodax-mcp-http`
(axum gateway on `MCP_PORT` default 8000), `indodax-mcp-server`
(stdio via rmcp, public-only credentials).

Crates (29): core, config, secrets, auth, transport, rate-limit, api,
market, account, websocket, order, trading, risk, portfolio,
execution, paper, strategy, backtest, alerts, reconciliation (inside
order crate), audit, agent, mcp (12 tool modules), gateway, oauth,
observability, storage, scheduler, event-bus, testkit.

## Responsibility map (behavioral reference)

- `core`: Decimal money/price/quantity, Asset/Symbol, OrderState (14),
  RiskOutcome/Reason, ExecutionMode/Capability, typed errors (10
  categories), SystemEvent union.
- `auth`: HMAC-SHA512 for v1, HMAC-SHA256 for v2, monotonic ms nonce.
- `transport`: reqwest client, 30s timeout, retry 3x on 429/5xx/timeout
  with exponential backoff, no signing.
- `rate-limit`: token bucket per client, default 7 rps, env override.
- `api`: `IndodaxRest` with public_get, private_post_v1 (Key/Sign
  headers, form body), private get/post/delete v2 (X-APIKEY/Sign,
  sorted query, timestamp plus recvWindow 5000). v1 envelope
  success/return, v2 code/msg with -1002 auth mapping.
- `market`: normalize flexible spellings, 30s snapshot cache, ticker
  parse from string-or-number fields.
- `account`: getInfo parse, openOrders raw, transHistory 7-day
  YYYY-MM-DD validation.
- `websocket`: one-shot snapshots over wss, static JWT fallback token,
  auth id 1, subscribe method 1, ping method 7, 10s timeout.
- `order`: explicit transition table (18 legal edges), timeout maps to
  Unknown, reconciler compares local vs exchange ids plus balance
  tolerance.
- `risk`: pure evaluate, kill switch/circuit/halted-reconcile first,
  then mode, capability, duplicate, staleness, notional, daily loss.
  paper_only denies live and FundingWithdraw.
- `execution`: ExecutionService requires approved RiskDecision, shared
  trait for PaperBackend and LiveBackend (v2 POST/DELETE order).
- `paper`: 100M IDR plus 1 BTC defaults, open/fill/cancel with 0.26%
  fee, JSON file persistence with reload.
- `trading`: propose validates shape, to_order builds Proposed,
  review walks Validating to RiskCheck to Approved/Submitting or
  Rejected, audit entries per step.
- `agent`: intent/proposal types only, no execution authority.
- `strategy`: moving-average signal, no order placement.
- `backtest`: threshold-cross replay, separate from paper.
- `alerts`: above/below/percent conditions against live price,
  persisted JSON.
- `audit`: append trail, JSONL flush, no secret fields.
- `storage`: Repository trait plus FileStore JSON.
- `event-bus`: tokio broadcast of SystemEvent.
- `scheduler`: interval jobs with abort handles.
- `observability`: 4 health states, 9 atomic counters.
- `mcp`: V2Server state, 58 tools across 12 modules, 7 resources,
  5 prompts, prefix dispatch, funding.withdraw always denied.
- `gateway`: axum routes /health and /call/:tool, optional bridge
  secret header.
- `oauth`: in-memory code/token store, PKCE S256 challenge.

## Tests

Per-crate unit tests plus `risk_integration`, `reconciliation`,
`paper_flow`, `mcp_surface` (tool uniqueness, description length,
safety keywords, offline reads, paper lifecycle, propose purity,
withdraw denial), `mcp_tools` envelope smoke.

## Docs/config/ops

README (156 lines, mermaid diagrams), 5 ADRs, architecture, MCP
surface, migration v1-to-v2, runbook, risk policy, modes, sources.
`config/` default/development/paper/live example TOMLs, `.env.example`
with only INDODAX credentials plus rate limit and WS token. CI runs
fmt, check, test, clippy. `scripts/check.sh` is the gate script.
