---
"indodax-mcp": minor
"indodax-mcp-cli": minor
---

Fix the stop and take-profit deadlock that left live positions unprotected.

The exchange reserves balance per open order, so a resting take-profit SELL
holds the quantity it will sell and a cut-loss SELL on that same quantity was
refused with `-2010 insufficient balance` the moment its price crossed. The
stop reported itself armed, then failed permanently on trigger, so the position
stayed exposed until a human woke up and cancelled the take-profit by hand.
Six historical stop failures were exactly this cause.

- `indodax_stop_create` checks live free balance before arming and returns
  `warning`, `liquidity`, and `remedy` naming the order holding the quantity,
  instead of reporting a stop that is certain to fail as safe.
- `indodax_oco_attach` links a cut-loss to a take-profit that already rests on
  the exchange. It places and cancels nothing, so it is the migration path for
  positions opened before `indodax_oco_bundle` existed.
- `indodax_stop_check` cancels a linked take-profit before placing, so a group
  behaves as one-cancels-the-other rather than as a label. `indodax_oco_bundle`
  now records the link too.
- A stop refused for a reserved quantity becomes `blocked` instead of
  `failed`. It stays armed, retries on the next check, and is counted separately
  from `open` so a stop that cannot fire is never presented as protection.
- Stop evaluation refreshes the account first, so an autopoll-only setup no
  longer dies on `STALE_ACCOUNT_STATE`.

Also from live use: `-2015` rejections carry allowlist CIDR blocks in
`safeMetadata`, `indodax_tickers_all` defaults to a `last` and `vol_idr`
projection instead of the full body for every pair, and `indodax_reconcile_full`
reports each open order's real side and size instead of only an id, which had
callers inferring a direction and showing a phantom SELL for a BUY.