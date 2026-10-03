<h1 align="center">INDODAX API mapping</h1>

This page maps documented exchange endpoints to the current TypeScript implementation. It distinguishes **implemented adapters** from MCP paths that remain paper-only or locked.

## Public REST

Base URL: https://indodax.com.

| Endpoint | Implementation | MCP surface | Verification |
| --- | --- | --- | --- |
| GET /api/server_time | PublicClient.serverTime | indodax_server_time | adapter/test |
| GET /api/pairs | PublicClient.pairs | indodax_pairs | adapter/test |
| GET /api/price_increments | PublicClient.raw | indodax_price_increments | shape-level |
| GET /api/summaries | PublicClient.summaries | resource path | shape-level |
| GET /api/ticker/{pair} | PublicClient.ticker plus market cache | indodax_ticker | adapter/test |
| GET /api/ticker_all | PublicClient.tickerAll | indodax_tickers_all | adapter/test |
| GET /api/trades/{pair} | PublicClient.trades | indodax_trades | adapter/test |
| GET /api/depth/{pair} | PublicClient.depth | indodax_orderbook | adapter/test |
| GET /tradingview/history_v2 | PublicClient.ohlc | indodax_candles | parameter tests |

The official public limit is 180 requests per minute. Repository throttling is an application control and is not the exchange quota.

## TAPI v2

Base URL: https://api.indodax.com.

The current official Trade API v2 documentation specifies HMAC-SHA256 signatures. GET and DELETE parameters use the query string. POST parameters use application/x-www-form-urlencoded. Signed requests include a timestamp or nonce, with recvWindow available for timestamp validity.

| Endpoint | Implementation | MCP surface | Status |
| --- | --- | --- | --- |
| POST /api/v2/order | LiveExecutor.submit with timeInForce GTC/MOC and STP passthrough | indodax_create_order | adapter implemented, live gated |
| DELETE /api/v2/order | LiveExecutor.cancelByExchangeId by orderId or origClientOrderId | indodax_cancel_order | adapter implemented, live gated |
| GET /api/v2/openOrders | AccountClient.openOrders | indodax_open_orders | implemented |
| GET /api/v2/order | AccountClient.getOrder | indodax_order | implemented |
| GET /api/v2/account | AccountClient.getAccount | indodax_account, indodax_balances | implemented |
| GET /api/v2/capital/withdraw/history | funding helper | indodax_withdraw_history | read-only |
| GET /api/v2/capital/deposit/hisrec | funding helper | indodax_deposit_history | read-only |
| GET /api/v2/fiat/orders | funding helper | indodax_fiat_history | read-only |
| GET /api/v2/capital/deposit/address/list | funding helper | indodax_deposit_address | read-only |
| GET /api/v2/order/histories | AccountClient.orderHistories | indodax_order_history | implemented |
| GET /api/v2/myTrades | AccountClient.myTrades | indodax_trade_history | implemented |
| POST /api/v2/capital/withdraw/apply | not implemented | withdrawal tool | always denied |
| POST /api/v2/fiat/withdraw | not implemented | withdrawal tool | always denied |

## Private WebSocket

Token endpoint `POST https://indodax.com/api/private_ws/v1/generate_token` (HMAC-SHA512 over `client=tapi&tapi_key=KEY`) is implemented in `requestPrivateToken` with the official `connect`/`subscribe` dialect and push parsing. Live channel connect runs through `indodax_private_connect`, which returns channel and state but never the token. No auto-connect on boot.

## Legacy v1

Legacy signing remains isolated as HMAC-SHA512.

The current code uses the legacy path only for the withdrawFee compatibility read. Old v1 order/history methods are not the preferred implementation path.

## Source of truth

Use [Source references](../references/sources.md) when changing endpoint, signing, parameter, or rate-limit documentation.
