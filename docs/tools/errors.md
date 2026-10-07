<h1 align="center">Error guide</h1>

Every failure arrives in one of two shapes. Handler errors use the
`{status: error, code, message, retryable}` envelope with `isError: true`;
schema violations are rejected by the MCP protocol layer before any handler
runs (harness text like `Invalid arguments for tool ...`) and must be treated
as validation failures with corrected arguments. Branch on `code` and the
`reason` inside `safeMetadata`, never on message prose.

| Code / reason | Meaning | Harness action |
| --- | --- | --- |
| `ValidationError` | Bad arguments, unknown pair, or a state that cannot satisfy the request. | Fix the arguments and retry once. For pairs, resolve with `indodax_search_symbols` first. |
| `PAIR_UNAVAILABLE` (`reason`) | The market answered without a quotable book: delisted, suspended, or too thin. | Skip the pair; check `tradable` on `indodax_pairs`. Do not retry as a transient failure. |
| `DUPLICATE_STOP` (`reason`) | A stop already arms the same pair, side, and quantity. | Cancel the named stop with `indodax_stop_cancel` before attaching another. |
| `FIAT_USE_FIAT_HISTORY` (`reason`) | A coin-only funding endpoint received a fiat code such as IDR. | Call `indodax_fiat_history` for IDR instead. |
| `FUNDING_UNAUTHORIZED` (`reason`) | The key lacks the funding grant for the refusing tool (`haveGrant: false`, `needGrant`, `tool` named). | Use a key with a funding grant, or treat funding as unavailable; market, paper, and trade paths are unaffected. |
| `possible_ip_not_allowlisted` (`reason`) | HTTP 403/401 arrived with no machine-readable code, most often an IP allowlist block. | Allowlist the egress address (`egressCidrV4`/`egressCidrV6`) for the matching family, or confirm the key has no IP restrictions. |
| `ip_not_allowlisted` (`reason`, exchange code `-2015`) | The exchange confirmed an unauthorized IP. | Same allowlist action as above; the signature itself was accepted. |
| `insufficient_balance` (`reason`, exchange code `-2010`) | The quantity is not free, often reserved by a resting take-profit. | Check `indodax_balances` versus open orders; link the stop with `indodax_oco_attach` so the trigger releases the quantity first. |
| `order_not_found` (`reason`, codes `-2011`, `-2013`) | The exchange does not know the order id. | Confirm with `indodax_order_history` before assuming the position is open. |
| `order_already_completed` (`reason`, code `-2012`) | The order already filled or cancelled. | Do not retry; read final state from `indodax_order` or history. |
| `STALE_MARKET_DATA`, `STALE_ACCOUNT_STATE`, `COOLDOWN_ACTIVE` | Retryable local context refusals on stops. | Refresh with `indodax_account` (account) or wait out the cooldown, then `indodax_stop_check` again; blocked stops also retry via `indodax_stop_retry`. |
| `UnknownExecutionResultError` | Timeout or dropped connection after a live submission. | Treat as unknown, reconcile against exchange order and trade state, and never blindly resubmit. |
| `ExchangeRateLimitError`, `ExchangeNetworkError`, `ExchangeTimeoutError` | Retryable transport faults (`retryable: true`). | Back off and retry safe reads; never auto-retry a state-changing request without proven idempotency. |
| `MIN_ORDER_SIZE`, `MAX_ORDER_SIZE`, `LIVE_MODE_DENIED`, `CAPABILITY_DENIED` | Deterministic risk denials. | Resize, split, or supply the missing gate (paper default; live needs `APP_ENV=live`, `TRADE_ENABLED=true`, credentials, acknowledgement, risk ALLOW). |

Withdrawal is always `funding.withdraw is disabled and needs a separate grant`
by design; no flag enables it. When evidence is incomplete, report uncertainty
instead of inventing a fill, balance, or reconciliation result.
