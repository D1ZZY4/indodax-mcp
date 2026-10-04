<h1 align="center">Order tools</h1>

Validation and placement share one intent pipeline
(`draftIntent` → `propose` → `toOrder` → risk `review` → execution).
Paper is the default everywhere; live needs **all** of the gate below.

Live gate checklist (every live call): `mode: "live"` plus
`acknowledged: true` plus `APP_ENV=live` plus `TRADE_ENABLED=true` plus
credentials plus risk `ALLOW`. Miss one and the call is denied.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_validate_order` | `pair`, `side` BUY/SELL, `quantity` positive number, `price` positive optional, `mode` paper/live/shadow optional, `timeInForce` GTC/MOC/FOK optional, `stpMode` optional | `{ proposal, order, decision, executed: false }` | Executes nothing. The returned order state is `PROPOSED`, never `ACCEPTED`. Audit entries are still written for traceability. |
| `indodax_propose_order` | Same as validate plus `reason` optional | Same shape, `executed: false` | A proposal is not an order and creates nothing. |
| `indodax_create_order` | Same as propose plus `acknowledged` optional, `clientOrderId` 1-36 optional | Paper or live `ExecutionResult` (`accepted`, ids, `executedAt`); acceptance is not a fill | `timeInForce`: GTC/MOC for LIMIT, FOK for MARKET. Repeated `clientOrderId` replays the first paper result instead of placing twice. |
| `indodax_cancel_order` | `orderId` or `clientOrderId` (one required), `mode`?, `acknowledged`?, `symbol`? (live only) | `{ orderId, status: "cancelled" }` or live result | Paper cancels by any id form with refund. Live cancel additionally needs the full live gate plus `symbol`. |

Errors: `ValidationError` (shape, pair, missing live fields), `AuthorizationError`
(live gate), `RiskDeniedError` (risk verdict), `OrderRejectedError` (paper
funds or exchange rejection).

Related: `indodax_paper_order` (simulation shortcut), `indodax_risk_evaluate`,
`orders://open` resource.
