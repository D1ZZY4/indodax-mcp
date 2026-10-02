# INDODAX API mapping

Every official endpoint maps to implementation, schema, service,
MCP tool, and test. Only documented endpoints are official.

## Public REST (`packages/indodax-client`)

| Endpoint | Schema | Service | MCP tool | Test |
|---|---|---|---|---|
| `GET /api/server_time` | `serverTimeSchema` | `PublicClient.serverTime` | `indodax_server_time` | live check |
| `GET /api/pairs` | `pairsSchema` | `PublicClient.pairs` | `indodax_pairs` | live check |
| `GET /api/price_increments` | raw JSON | `PublicClient.raw` | `indodax_price_increments` | stub shape |
| `GET /api/summaries` | `summariesSchema` | `PublicClient.summaries` | (resource data) | stub shape |
| `GET /api/ticker/{pair}` | `tickerResponseSchema` | `getTicker` + cache | `indodax_ticker` | stub + live |
| `GET /api/ticker_all` | `tickerAllSchema` | `PublicClient.tickerAll` | `indodax_tickers_all` | stub shape |
| `GET /api/trades/{pair}` | `tradesSchema` | `PublicClient.trades` | `indodax_trades` | stub shape |
| `GET /api/depth/{pair}` | `depthSchema` | `PublicClient.depth` | `indodax_orderbook` | stub shape |
| `GET /tradingview/history_v2` | `ohlcSchema` | `PublicClient.ohlc` | `indodax_candles` | param test |

## TAPI v2 (`packages/indodax-auth`, `indodax-account`, execution)

| Endpoint | Signing | Service | MCP tool |
|---|---|---|---|
| `POST /api/v2/order` | HMAC-SHA256 sorted body | `LiveExecutor.submit` | `indodax_create_order` (live path locked) |
| `DELETE /api/v2/order` | HMAC-SHA256 sorted query | `LiveExecutor.cancelByExchangeId` | `indodax_cancel_order` (live path locked) |
| `GET /api/v2/openOrders` | HMAC-SHA256 | planned live reconcile | `indodax_reconcile_orders` (paper now) |
| `GET /api/v2/order` | HMAC-SHA256 | planned live lookup | (via reconcile) |
| `GET /api/v2/account` | HMAC-SHA256 | `AccountClient` | `indodax_account`, `indodax_balances` |
| capital histories | HMAC-SHA256 | funding tools | `indodax_withdraw_history`, `indodax_deposit_history` |
| `GET /api/v2/fiat/orders` | HMAC-SHA256 | funding tools | `indodax_fiat_history` |
| deposit address list | HMAC-SHA256 | funding tools | `indodax_deposit_address` |
| `POST /api/v2/capital/withdraw/apply` | HMAC-SHA256 | NOT implemented (locked) | always denied |
| `POST /api/v2/fiat/withdraw` | HMAC-SHA256 | NOT implemented (locked) | always denied |
| `GET /api/v2/order/histories` | HMAC-SHA256 | account history helper | `indodax_order_history` planned |
| `GET /api/v2/myTrades` | HMAC-SHA256 | account history helper | `indodax_trade_history` planned |

## Legacy v1

Isolated `LegacyTapiSigner` (HMAC-SHA512) plus nonce. Used only
for `withdrawFee` reads and the private WebSocket token request.
`tradeHistory` and `orderHistory` are decommissioned and have no
preferred path.
