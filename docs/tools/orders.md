<h1 align="center">Order tools</h1>

Validation and placement share one intent pipeline
(`draftIntent` → `propose` → `toOrder` → risk `review` → execution).
Paper is the default everywhere; live needs **all** of the gate below.

Live gate checklist (every live call): `mode: "live"` plus
`acknowledged: true` plus `APP_ENV=live` plus `TRADE_ENABLED=true` plus
credentials plus risk `ALLOW`. Miss one and the call is denied.

Credentials must reach the **server process**, not the client that calls it: an
MCP client cannot inject environment variables into a server it did not start.
If `indodax_config_status` reports `credentialsConfigured: false` while you
believe credentials are configured, read `configSource.credentials` and
`remedy`. They name the channel that supplied each variable, which separates a
harness entry that starts the server separately from a genuinely missing key.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_validate_order` | `pair`, `side` BUY/SELL, `quantity` positive number, `price` positive optional, `mode` paper/live/shadow/development optional, `timeInForce` GTC/MOC/FOK optional, `stpMode` optional, `riskBudget` positive optional in quote units | `{ proposal, order, decision, executed: false, riskBudget, riskMultiple, riskWarning }` | Executes nothing. The returned order state is `PROPOSED`, never `ACCEPTED`. Audit entries are still written for traceability. `timeInForce` and `stpMode` reach the proposal order and enforce the same shape rules as `indodax_create_order` (FOK only on MARKET, GTC/MOC only on LIMIT). When the pair increment is known and the quantity breaks it, a `quantity increment` warning names the fix; offline, the check is skipped rather than failed. `riskBudget` is advisory only and never changes the verdict: the response carries the notional-vs-budget multiple plus a warning above 1x, so a small-budget harness sizes before placing. Unsure about fillability? Call `indodax_quote` first for an instant-vs-parked estimate. |
| `indodax_propose_order` | Same as validate plus `reason` optional | Same shape, `executed: false` | A proposal is not an order and creates nothing. |
| `indodax_create_order` | Same as propose plus `acknowledged` optional, `clientOrderId` 1-36 optional | Paper or live `ExecutionResult` (`accepted`, ids, `executedAt`); acceptance is not a fill | `timeInForce`: GTC/MOC for LIMIT, FOK for MARKET. Repeated `clientOrderId` replays the first paper result instead of placing twice. `clientOrderId` must be unique per exchange: a reused live id is rejected opaquely, so generate fresh ids and check status via `indodax_order` before resubmitting. |
| `indodax_cancel_order` | `orderId` or `clientOrderId` (one required), `mode`?, `acknowledged`?, `symbol`? (live only) | `{ orderId, status: "cancelled" }` plus `balances` after a paper refund, or live result | Paper cancels by any id form with refund. Live cancel additionally needs the full live gate plus `symbol`. |

Errors: `ValidationError` (shape, pair, missing live fields), `AuthorizationError`
(live gate), `RiskDeniedError` (risk verdict), `OrderRejectedError` (paper
funds or exchange rejection; exchange codes carry a `next:` remedy, for example
`-2010` points at `indodax_balances` and `-2015` at the API key IP allowlist), `UnknownExecutionResultError` (non-retryable;
live transport timeout or network failure with the client order id preserved.
Reconcile before any retry).

## timeInForce and self-trade prevention

Both options are **passthrough to the exchange**: the server validates their
shape and forwards them, it does not implement their matching semantics.
The enforced shape rules are:

- `GTC` and `MOC`: LIMIT orders only.
- `FOK`: MARKET orders only.
- `stpMode` (`EXPIRE_TAKER`, `EXPIRE_MAKER`, `EXPIRE_BOTH`): passed as
  `selfTradePreventionMode`. The exchange default is `EXPIRE_MAKER` for
  orders created on or after 14 Jul 2026.

Paper simulation ignores both fields (paper fills are immediate and manual),
so a paper result proves validation and risk only, never TIF/STP behavior.
For exact exchange matching semantics, see the official Trade API v2
document, not this page.

## OCO bundle

`indodax_oco_bundle` places a position and its protection in one call:
optional `entryPrice`, then a required `takeProfitPrice` and `stopPrice`, plus
a required `stopPrice` below the take profit on both sides.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_oco_bundle` | `pair`, `side` BUY/SELL, `quantity`, optional `entryPrice`, required `takeProfitPrice`, required `stopPrice`, `mode` paper/live?, `acknowledged`?, `clientOrderId`? | `{ pair, side, mode, quantity, groupId, entry, stopId, legs, partial, status, note, summary, remedy }` | Every leg reports its own outcome, so a partial result is visible rather than assumed. The stop registers before the take-profit leg is placed, so the leg has a floor while the other call is in flight. Legs after the first skip only the inter-order cooldown, because they are one decision; limits, deadman, balance, and reconciliation are still enforced per leg. The take-profit it places reserves the quantity, so the stop is linked to it and cancels it before firing. |

When the entry leg itself is refused the whole call fails and nothing is
armed, so a rejected entry never leaves a dangling stop.

The take-profit it places reserves the quantity, so a manual cut-loss on the
same size would be refused with `-2010`. Link an existing resting take-profit
to a stop with `indodax_oco_attach`, documented under
[stop tools](stops.md#a-stop-and-a-take-profit-compete-for-the-same-balance).

Related: `indodax_paper_order` (simulation shortcut), `indodax_risk_evaluate`,
`orders://open` resource.
