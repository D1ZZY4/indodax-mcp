# MCP surface

Transport: stdio JSON-RPC via `indodax-mcp-server`, HTTP via `indodax-mcp-http`.
Both share `V2Server::execute_tool`, so behavior is identical.

## Tool groups

Market (7, read-only, live): server_time, ticker, ticker_all, pairs,
orderbook, trades, candles.

Account (6, read-only, needs credentials): info, balances, open_orders,
order_history, trade_history, transactions (7-day window validated).

Orders (3): live order_get (needs credentials), paper_order_get,
order_reconcile (paper vs live price, no mutation).

Trading (4): validate and propose never execute. place and cancel run
paper by default through risk and ExecutionService. Live is denied by
server policy and needs acknowledged true even where enabled.

Portfolio (3, read-only): paper valuation at live prices, positions, pnl.

Risk (3, read-only or pure): limits, policy, evaluate.

Paper (8): balances, status, place, fill, cancel, orders, reset, topup.
Simulated money only.

Strategy (2) and backtest (1): pure signal evaluation and replay.
Backtest is separate from paper trading.

Alerts (4): create, list, cancel, check against live price. Persisted
when the server is configured with a state path.

Reconciliation (2) and audit (2): divergence analysis and traces.
Audit never contains secrets.

System (4), auth (2): health, version, mode, capabilities, credential
presence booleans. No secret content is ever returned.

Funding (3): fee and deposit address reads need credentials. Withdraw
is disabled by default and always denied without a separate grant.

WebSocket (2): one-shot ticker and book snapshots, 10s timeout.

## Resources and prompts

Resources expose state: config, pairs, market cache size, paper state,
risk limits, health, recent audit. Prompts guide analyze_market,
check_portfolio, preflight_trade, review_open_orders, and
explain_risk_rejection. Prompts never place orders.
