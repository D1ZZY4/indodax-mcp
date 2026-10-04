<h1 align="center">Tool guides</h1>

Per-area agent-harness guides for every MCP tool: full parameters, response
shapes, errors, and worked usage. Start here, then open one area file.

| Area | File | Tools |
| --- | --- | --- |
| Market | [market.md](market.md) | server_time, pairs, ticker, tickers_all, orderbook, trades, candles, price_increments, summaries, quote |
| Account | [account.md](account.md) | account, balances, capabilities |
| Orders | [orders.md](orders.md) | validate_order, propose_order, create_order, cancel_order |
| Paper | [paper.md](paper.md) | paper_account, paper_status, paper_orders, paper_snapshots, paper_fills, paper_order, paper_fill, paper_cancel, paper_reset |
| Portfolio | [portfolio.md](portfolio.md) | portfolio, positions, pnl, exposure |
| Risk | [risk.md](risk.md) | risk_limits, risk_state, risk_evaluate |
| Strategy | [strategy.md](strategy.md) | strategies, strategy, strategy_evaluate, strategy_validate, backtest_run, backtest_get, backtest_compare |
| Alerts | [alerts.md](alerts.md) | alerts, alert_create, alert_cancel, alert_check |
| Reconciliation | [reconcile.md](reconcile.md) | reconcile_balances, reconcile_orders, reconciliation_state, reconcile_full, reconcile_trades |
| Audit | [audit.md](audit.md) | audit_events, execution_trace, audit_risk |
| System | [system.md](system.md) | health, readiness, version, system_capabilities, config_status, runtime_status, auth_status, funding_withdraw, ws_status, ws_ticker |
| Funding | [funding.md](funding.md) | withdraw_history, deposit_history, fiat_history, deposit_address, withdraw_fee |
| History | [history.md](history.md) | open_orders, order, order_history, trade_history |
| Operations | [ops.md](ops.md) | backtest_get, backtest_compare, strategy_validate, reconcile_trades, audit_risk, exposure, ws_reconnect, private_connect, private_disconnect |
| Deadman | [deadman.md](deadman.md) | deadman_arm, deadman_status, deadman_disarm, deadman_heartbeat |
| Stops | [stops.md](stops.md) | stop_create, stops, stop_cancel, stop_check |
| Meta | [docs.md](docs.md) | docs (this guide system itself) |

Conventions used on every page: money serializes as strings, pair
spellings are accepted flexibly and normalized per endpoint, errors are
either the `{status, code, message, retryable}` envelope or a protocol-level
schema rejection, and paper paths never touch the exchange.

Pair contract: every tool accepts any common spelling (`btc_idr`,
`BTCIDR`, `BTC/IDR`) on input, while stored state, comparisons, and
responses always use the canonical lowercase `base_quote` form
(`btc_idr`). Money arrives as JSON numbers on input and leaves as decimal
strings on output; never parse output money into floats for accounting.
