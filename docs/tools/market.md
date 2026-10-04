<h1 align="center">Market tools</h1>

Public, read-only, no credentials. Every pair argument accepts any common
spelling (`btc_idr`, `BTCIDR`, `BTC/IDR`); the server normalizes it into the
exchange wire spelling per endpoint.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_server_time` | none | `{ timezone, server_time }` (ms) | Clock sync. |
| `indodax_pairs` | none | Array of `{ id, symbol, base_currency, traded_currency, ticker_id, trade_min_*, price_precision, quantity_increment, trade_fee_*, is_maintenance?, is_market_suspended? }` | `ticker_id` like `btc_idr` is the canonical input spelling. |
| `indodax_ticker` | `pair` string required | `{ high, low, last, buy, sell, server_time?, symbol, fetchedAt }`, money as strings | Cached 30s. |
| `indodax_tickers_all` | `quote` string 1-10 optional, `limit` int 1-500 optional | Map of pair to ticker body | No filter and no limit defaults to **100 rows** so one call cannot flood a harness context. |
| `indodax_orderbook` | `pair` required, `levels` int 1-100 default 20 | `{ buy, sell, spread, mid }`, money as strings | `spread`/`mid` derive from best bid/ask with Decimal math; `null` on an empty side. |
| `indodax_trades` | `pair` required, `limit` int 1-500 optional (default all) | Array of `{ date, price, amount, tid, type }` (`type` is lowercase `buy`/`sell`) | — |
| `indodax_candles` | `symbol` required (any spelling), `timeframe` default `"60"` (`1, 15, 30, 60, 240, 1D, 3D, 1W`), `from`/`to` unix seconds default last 24h | Array of `{ Time, Open, High, Low, Close, Volume }`; money fields are strings, `Time` is unix seconds | Symbol is uppercased to compact form (`BTCIDR`) before the call. |
| `indodax_price_increments` | none | Raw exchange payload | Shape-level only. |
| `indodax_summaries` | none | `{ tickers, prices_24h?, prices_7d? }` | 24h/7d overview. |

Errors: `ValidationError` for bad pairs, `ExchangeApiError`/`ExchangeNetworkError` for upstream failures (retryable only for network/rate-limit codes).

Related: `indodax_ws_ticker` (one-shot WebSocket snapshot), `market://snapshot` and `pairs://metadata` resources.
