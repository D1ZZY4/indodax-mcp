# @indodax-mcp/cli

Command line companion to [`@indodax-mcp/indodax-mcp`](https://www.npmjs.com/package/@indodax-mcp/indodax-mcp),
the MCP server for [INDODAX](https://indodax.com) spot trading.

Read-only market data, paper account state, and risk limits from a terminal,
without standing up the MCP server.

> Unofficial community software, not affiliated with or endorsed by INDODAX.
> Cryptocurrency trading can result in loss of funds.

## Install

```bash
bun add -g @indodax-mcp/cli
```

Installs the `indodax` binary. Requires the Bun runtime.

Without a global install, `bunx -y @indodax-mcp/cli` and `npx -y @indodax-mcp/cli` both run the same binary.

## Commands

```bash
indodax market ticker btc_idr   # last price for one pair
indodax market pairs            # full pair list with minimums and precisions
indodax market server-time      # exchange clock, for recvWindow sync

indodax account info            # permissions and balance count (needs credentials)
indodax account balances        # per-asset free and locked

indodax paper balances          # virtual ledger balances
indodax paper status            # trade count, open orders, fees
indodax paper reset --acknowledged   # clears the paper ledger

indodax risk limits             # deterministic notional and freshness limits
indodax risk state              # policy, Deadman state, credential origin

indodax system health           # local component health rollup
indodax system capabilities     # paper open, live gated, withdraw disabled
```

Add `-o json` to a market command for machine-readable output.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Credentials missing for a private command |
| `3` | Destructive action not acknowledged |
| `64` | Unknown command or action (usage error) |

An unknown action reports the accepted values rather than falling through to a
default read, so a typo cannot look like a successful call.

## Safety

The CLI exposes no order placement and no withdrawal. `paper reset` is the only
destructive action and requires `--acknowledged`. The paper ledger is a
simulation: balances start at 100,000,000 IDR and 1 BTC, and nothing here ever
reaches the exchange.

## Credentials

Read from the environment, or from a repository `.env` beside the workspace:

```bash
INDODAX_API_KEY=...
INDODAX_API_SECRET=...
```

Only `account` needs them. `indodax risk state` reports where each credential
came from (`process-env`, `repo-env-file`, or `absent`) without ever printing a
value, which is the fastest way to diagnose "I exported these but the process
never saw them".

## License

SSPL-1.0. Unofficial, provided as is, with no warranty.
