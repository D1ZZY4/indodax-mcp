<h1 align="center">Tool guides</h1>

Per-area agent-harness guides for every MCP tool: full parameters, response
shapes, errors, and worked usage. Start here, then open one area file.

| Area | File | Tools |
| --- | --- | --- |
| Market | [market.md](market.md) | server_time, pairs, ticker, tickers_all, orderbook, trades, candles, price_increments, summaries, quote, search_symbols, round_order, suggest_stop |
| Account | [account.md](account.md) | account, capabilities, positions_live, portfolio_snapshot |
| Orders | [orders.md](orders.md) | validate_order, create_order, cancel_order, oco_bundle |
| Paper | [paper.md](paper.md) | paper_ledger, paper_fills, paper_order, paper_fill, paper_cancel, paper_reset |
| Portfolio | [portfolio.md](portfolio.md) | portfolio, exposure |
| Risk | [risk.md](risk.md) | risk_limits, risk_state, risk_evaluate |
| Strategy | [strategy.md](strategy.md) | strategies, strategy_evaluate, backtest_run, backtest |
| Alerts | [alerts.md](alerts.md) | alerts, alert_create, alert_cancel, alert_check |
| Reconciliation | [reconcile.md](reconcile.md) | reconcile_paper, reconcile_exchange |
| Audit | [audit.md](audit.md) | audit |
| System | [system.md](system.md) | health, version, system_capabilities, config_status, runtime_status, funding_withdraw, ws_status, ws_ticker |
| Funding | [funding.md](funding.md) | funding |
| History | [history.md](history.md) | open_orders, order, order_history, trade_history, paper_fills |
| Operations | [ops.md](ops.md) | backtest, exposure, ws_reconnect, private_channel |
| Deadman | [deadman.md](deadman.md) | deadman_arm, deadman_status, deadman_disarm, deadman_heartbeat |
| Stops and OCO | [stops.md](stops.md) | stop_create, stops, stop_cancel, stop_check, stop_retry, oco_attach |
| Meta | [docs.md](docs.md) | docs |

Every area page carries a "What replaced the removed tools" section listing the
names this release retired and the argument that reaches the same answer.
Version 2.0.0 consolidated 91 tools into 68; no capability was dropped, but any
harness calling a removed name must be updated.

Conventions used on every page: money serializes as strings, pair
spellings are accepted flexibly and normalized per endpoint, errors are
either the `{status, code, message, retryable}` envelope or a protocol-level
schema rejection, and paper paths never touch the exchange.

Tool annotations: every tool exposes MCP `annotations` derived from its
repository metadata, so a harness can gate a call before invoking it.
`readOnlyHint` is true for `riskClass: read`, `destructiveHint` mirrors the
declared `destructive` flag, `idempotentHint` is true when the tool declares
a non-`none` idempotency class, and `openWorldHint` is true for READ and
TRADE tools that reach the exchange. Metadata is a hint for the client, not
an authorization control: the central guard and the risk engine remain the
enforced boundary.

Pair contract: every tool accepts any common spelling (`btc_idr`,
`BTCIDR`, `BTC/IDR`) on input, while stored state, comparisons, and
responses always use the canonical lowercase `base_quote` form
(`btc_idr`). `indodax_search_symbols` resolves an unverified name against
the live pair list before anything else is called, so a guessed ticker is
reported as unknown instead of failing later.

Top of book is named the same way everywhere: `indodax_orderbook` and
`indodax_quote` both report `bestBid` and `bestAsk`, and both use `null`
rather than `0` for an empty side. Money arrives as JSON numbers on input and leaves as decimal
strings on output; never parse output money into floats for accounting.
