# @indodax-mcp/daemon

Long-running operational daemon for the INDODAX MCP server. It refreshes the
market cache on an interval and writes portfolio snapshots, so a long-running
deployment does not depend on an agent polling it.

## Install

```bash
bun add -g @indodax-mcp/daemon
```

## Run

```bash
indodax-daemon
```

The daemon reads the same environment as the MCP server. `INDODAX_API_KEY` and
`INDODAX_API_SECRET` are optional: without them the daemon runs in read-only
mode against the public API and performs no authenticated call.

```bash
INDODAX_API_KEY=... INDODAX_API_SECRET=... indodax-daemon
```

## Behavior

- Sends `SIGTERM` for a clean shutdown; the process exits 0.
- The interval jobs are in-memory. Restarting the daemon clears them.
- It never places, cancels, or withdraws an order. Order placement belongs to
  the MCP server, behind risk review.

## License

SSPL-1.0. See the `LICENSE` file in the repository root.