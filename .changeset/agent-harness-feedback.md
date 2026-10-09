---
"@d1zzy4-jethools/indodax-mcp": minor
"@d1zzy4-jethools/indodax-mcp-cli": minor
---

Agent-harness feedback round: rejections that carry a next action, consistent top-of-book fields, symbol lookup, and explicit signal verdicts.

- Exchange rejections are translated on every delivery path. The exchange answers order and cancel rejections with HTTP 4xx plus a JSON code, so the retry helper threw before the executor could read the payload and the caller received a bare transport string with no code and no remedy. The retry error now carries the status and raw body, the live executor recovers the payload from it, and verified codes such as `-2010` insufficient balance and `-2015` unauthorized IP resolve to a specific next action. A 5xx stays a retryable transport fault rather than being dressed up as a rejection.
- `indodax_orderbook` reports `bestBid`, `bestAsk`, `bestBidQty`, `bestAskQty`, `spreadPct`, and `empty`. Previously the tool carried no top-of-book price at all while `indodax_ticker` used `buy`/`sell` and `indodax_quote` used `bestBid`/`bestAsk`, so a caller reading `bestBid` from the orderbook got undefined and rendered a price of zero. An empty side is now `null` plus `empty: true` instead of zero.
- `indodax_search_symbols` resolves a base asset, quote, or full ticker against the live pair list. Guessing produced a ReferenceError in a real harness run because nothing could answer whether a ticker was tradable. Unknown names return `matched: 0` with a note rather than an error, and a suspended market is listed separately from a missing symbol. Rows carry `quantityIncrement` and `tradeMinQuote` so an order can be sized before it is placed.
- `indodax_strategy_evaluate` returns `verdict: ok` or `insufficient_data`. A window wider than the supplied closes is a thin market rather than a bad request, so it now succeeds with `side: null` and `strength: null` instead of failing, which removes the NaN percentages a screener derived from an absent signal. `indodax_strategy_validate` stays strict and still rejects the same input.
