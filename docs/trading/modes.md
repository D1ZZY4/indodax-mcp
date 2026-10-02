# Trading modes

The repository models paper, live, and shadow execution modes. The current application policy supports paper mode only.

## Current behavior

~~~text
mutation request
      |
      v
mode selection
      |
      +--> paper --> risk review --> PaperExecutor
      |
      +--> live ---> server policy ---> DENY
      |
      +--> shadow -> no supported live execution path
~~~

Paper is the safe default.

The indodax_paper_order flow builds a trade intent, creates an order proposal, runs risk review, and executes through ExecutionService into PaperExecutor.

The indodax_create_order tool routes paper requests into the same paper placement helper. Live requests are explicitly denied after acknowledgement checks.

## Live readiness boundary

The live adapter exists and uses TAPI v2 signing, but enabling live is not currently a supported configuration.

Before live execution can be enabled, the repository needs integrated proof for complete runtime risk context, durable state, exchange reconciliation, client-order idempotency, retry behavior for state-changing requests, private-order WebSocket handling, Deadman lifecycle integration, and end-to-end live-safe tests.

No documentation should imply that setting APP_ENV=live currently enables trading.

## Ambiguous outcomes

A timeout or dropped connection does not prove that an order failed.

The intended policy is:

1. preserve the client order identifier;
2. treat the result as unknown;
3. reconcile with the exchange;
4. only then determine whether another submission is safe.

The current transport helper still applies generic retries, so this policy is an architectural requirement that is not yet fully enforced across the complete live path.

## Withdrawal

Withdrawal is not a trading mode. The server exposes read-only funding information, but the withdrawal mutation is always denied.
