# Architecture

## Direction

```text
MCP / CLI / Daemon
→ Agent intent / TradingService
→ RiskEngine
→ ExecutionService
→ PaperBackend | LiveBackend
→ Indodax API
```

## Boundaries

* `indodax-core`: canonical types, errors, money, orders, risk verdicts.
* `indodax-auth` + `indodax-transport` + `indodax-rate-limit`:
  signing, HTTP retry, token bucket. No business logic.
* `indodax-api`: typed V1/V2 REST operations only.
* `indodax-market` / `indodax-account`: normalized reads + caches.
* `indodax-order`: explicit lifecycle plus reconciliation.
* `indodax-risk`: deterministic policy, no MCP dependency.
* `indodax-execution`: backend trait plus risk-guarded service.
* `indodax-paper`: simulated backend sharing execution contracts.
* `indodax-trading`: intent validation and risk review orchestration.
* `indodax-agent`: external AI boundary (intent/proposal only).
* `indodax-mcp`: thin tools over services.
* `indodax-gateway` + `indodax-oauth`: HTTP transport isolation.

Withdrawal uses `Capability::FundingWithdraw`, never implied by trading.
