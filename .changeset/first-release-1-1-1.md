---
"@d1zzy4-jethools/indodax-mcp": minor
"@d1zzy4-jethools/indodax-mcp-cli": minor
---

First published release of the TypeScript/Bun rebuild as 1.1.1.

Safety and correctness fixes, each covered by regression tests:

- A stop refused for stale context is no longer retired. The retryable-refusal
  classification was anchored to the first reason code in a risk denial, so a
  `STALE_ACCOUNT_STATE` or `STALE_MARKET_DATA` refusal that followed another
  reason was treated as terminal, removing downside protection from a position
  that was still open. Classification now inspects every reason code.
- `indodax_ws_reconnect` reports partial success. With `scope: "all"` and no
  credentials, the private leg threw outside its own handler and discarded a
  market leg that had already reconnected. Each leg now reports independently
  with `reasons` and a `partial` flag.
- `indodax_alert_check` cannot report a consumed trigger as a false negative.
  The response carries `alreadyTriggered`, so `triggeredCount: 0` is
  distinguishable from "never fired", plus `priceSource`, `priceAgeMs` and
  `priceStale`.
- `indodax_portfolio_snapshot` counts triggered and cancelled alerts from the
  full history, so a monitoring loop can tell "nothing armed" from "it fired
  and someone already acted".
- `indodax_candles` constrains `timeframe` to the exchange-accepted set, so an
  unsupported alias fails locally instead of costing a live round trip, and
  attributes its rows to a pair, timeframe and window.
- `indodax_ticker` reports a `dataQuality` block and warns on a cache hit, since
  a cached spread can differ from the live orderbook.
- `indodax_open_orders` reports `source` and `observedAt` alongside the set.
- The server version lives in one module, asserted against both publishable
  manifests.

Documentation corrected against the implementation: tool count, guide index
rows, candles response shape and timeframe set, alert parameter shape and
consumption semantics, open-order and ticker provenance, and the stop outcome
diagrams.
