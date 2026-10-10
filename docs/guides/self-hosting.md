<h1 align="center">Self-hosting guide</h1>

How to run, deploy, and operate this server yourself. Every shell command here
was executed against the published packages. The Docker section is the
exception and is marked as unverified.

For configuration, troubleshooting, and safety flags, see
[Self-host operations](../operations/self-host-operations.md).

## Choose a shape first

| Shape | Use when | Database | Credentials |
| --- | --- | --- | --- |
| Local stdio | An agent harness on the same machine | none | optional |
| Local HTTP | Several clients, or a client that cannot spawn a process | optional | optional |
| Compose | A container host, team use, or a server | included | optional |
| Source checkout | Contributing, or running unreleased code | optional | optional |

Start with local stdio. No database, no clone, no credentials, smallest blast
radius.

## What every shape has in common

### Bun is required

The published binaries carry a `#!/usr/bin/env bun` shebang. `bunx`, `npx`, and
a global install all work, and all of them end up executing Bun.

```bash
bun --version   # 1.4.2 or newer
```

### Credentials are optional

Without a key the server starts and every read-only tool works against the
public API. Authenticated and live tools refuse with a named reason rather than
failing vaguely. That is the correct way to explore.

```bash
export INDODAX_API_KEY=...
export INDODAX_API_SECRET=...
```

Use a dedicated TAPI v2 key with exchange-side IP restrictions. Never commit a
key. Rotate it immediately if it is ever exposed.

## Shape 1: local stdio

Nothing to install:

```bash
bunx -y @indodax-mcp/indodax-mcp
```

That starts the server on stdio and waits for an MCP host. On its own it is not
useful, because stdio needs a client to talk to.

### Wiring it to an MCP client

**OpenCode**, config file `~/.config/opencode/opencode.jsonc`, takes a command
**array** plus an **`environment`** object:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "indodax-mcp": {
      "type": "local",
      "command": ["bunx", "-y", "@indodax-mcp/indodax-mcp"],
      "environment": { "APP_ENV": "paper" },
      "enabled": true,
      "timeout": { "catalog": 120000, "execution": 120000 }
    }
  }
}
```

**Claude Desktop**, config file `claude_desktop_config.json`, takes `command`
as a string, a separate `args` array, and an **`env`** object:

```json
{
  "mcpServers": {
    "indodax-mcp": {
      "command": "bunx",
      "args": ["-y", "@indodax-mcp/indodax-mcp"],
      "env": { "APP_ENV": "paper" }
    }
  }
}
```

The formats are not interchangeable. Copying one into the other starts a
process with no arguments, which looks like a broken server.

### The credential trap

**An MCP client cannot inject environment into a process it did not launch.**
This is the most common reason a key that is clearly exported does nothing.

| Where the server runs | Where the key must go |
| --- | --- |
| Client spawns the process | that client's environment block |
| You start it, client connects over HTTP | the shell that starts it |

Diagnose with `indodax_config_status`, never by guessing. It reports
`process-env`, `repo-env-file`, or `absent` per credential and never prints a
value.

### Verifying it works

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"c","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"indodax_health","arguments":{}}}' \
  | bunx -y @indodax-mcp/indodax-mcp
```

Expect `serverInfo` naming `indodax-mcp`, and a health body reporting
`"status": "healthy"`.

## Shape 2: local HTTP

Use this when more than one client needs the server, or when a client cannot
spawn a process.

```bash
bunx -y @indodax-mcp/mcp-http
```

It binds `127.0.0.1` on port `8000` by default. Override with `MCP_HOST` and
`MCP_PORT`:

```bash
MCP_HOST=127.0.0.1 MCP_PORT=8080 bunx -y @indodax-mcp/mcp-http
```

Check it:

```bash
curl -s http://127.0.0.1:8000/health
# {"status":"ok","server":"indodax-mcp","version":"2.0.0","mode":"paper"}
```

Point a client at it as a remote server:

```jsonc
{
  "mcp": {
    "indodax-mcp": {
      "type": "remote",
      "url": "http://127.0.0.1:8000/mcp",
      "enabled": true,
      "timeout": { "catalog": 120000, "execution": 120000 }
    }
  }
}
```

**Keep it on loopback unless there is a reason not to.** Anyone who can reach
the port can read balances and, if live is enabled, place orders. The HTTP
transport has **no authentication of its own**, so `MCP_HOST=0.0.0.0` on a
reachable host hands over the account. Put a reverse proxy with
authentication in front of it first.

### Running it as a user service on Linux

The repository ships a unit for the daemon only, not the gateway. A minimal
gateway unit:

```ini
# ~/.config/systemd/user/indodax-mcp-http.service
[Unit]
Description=INDODAX MCP HTTP gateway
After=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.config/indodax-mcp/gateway.env
ExecStart=%h/.bun/bin/bunx -y @indodax-mcp/mcp-http
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

The env file holds the configuration and is the only file needing restrictive
permissions:

```bash
# ~/.config/indodax-mcp/gateway.env   (chmod 600)
APP_ENV=paper
MCP_HOST=127.0.0.1
MCP_PORT=8000
# INDODAX_API_KEY=...
# INDODAX_API_SECRET=...
# DATABASE_URL=postgresql://user@127.0.0.1:5433/indodax
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now indodax-mcp-http.service
```

Call `bunx` by absolute path in `ExecStart`. A user service receives a minimal
`PATH` that may not include the Bun shim directory, and the service then fails
with a confusing "not found".

The committed `deploy/systemd/indodax-daemon.service` is a **system** unit
(`multi-user.target`) for a clone at `/opt/indodax-mcp`, so adjust both paths
before using it.

## Shape 3: Docker Compose

**Not executed on the machine that wrote this page: Docker was not available
there.** The files are committed and internally coherent, but treat this shape
as unverified until it runs once on your own host.

```bash
git clone https://github.com/D1ZZY4/indodax-mcp.git
cd indodax-mcp/deploy/compose
docker compose up --build
```

Three services start:

| Service | Role |
| --- | --- |
| `postgres` | PostgreSQL 17 with a healthcheck, data in the `pgdata` volume |
| `migrate` | applies the Drizzle migrations once, then exits |
| `mcp-http` | the gateway, started only after `migrate` succeeds |

The ordering is not decoration. On a fresh volume the gateway would otherwise
attach its mirrors to a database with no tables, which reports as "configured
but unreachable".

`deploy/docker/Dockerfile` copies `docs/` into the image so `indodax_docs` can
serve the per-area guides at runtime, and it runs the gateway **from the source
tree** with `bun apps/mcp-http/src/main.ts`, not from the published package. An
image built from a checkout therefore serves the code in that checkout.

### Two exposures to fix before using this anywhere shared

The committed compose file is written for local experimentation. Both of these
must change before it runs anywhere but your own machine.

**PostgreSQL is published with default credentials.** Port `5432` is published
on every host interface with the password `indodax` written in the file, so
anyone who can reach the host gets a full database with known credentials.

```yaml
ports: ["127.0.0.1:5432:5432"]
```

**The gateway is published on every interface.** `MCP_HOST=0.0.0.0` inside the
container is required, because a process on container loopback is unreachable
from the host bridge. That is correct inside the container, but the published
port has no authentication at all.

```yaml
ports: ["127.0.0.1:8000:8000"]
```

### Adding credentials

The gateway carries none by default. Add them deliberately, and keep
`APP_ENV` at `paper` until you have read the safety section:

```yaml
environment:
  APP_ENV: paper
  INDODAX_API_KEY: ${INDODAX_API_KEY}
  INDODAX_API_SECRET: ${INDODAX_API_SECRET}
```

## Shape 4: source checkout

Needed to contribute, or to run code that is not published yet. See
[Run from source](../../README.md#run-from-source) in the repository README for
the clone and build steps.

### Published versus local code

`bunx` runs the published tarball. A checkout runs the working tree. They are
not the same thing at a given moment:

- after `git pull`, the published package is unchanged until a new version ships
- a gateway started before the pull keeps serving the old code until restarted

Pin the version when you need reproducibility:

```bash
bunx -y @indodax-mcp/indodax-mcp@2.0.0
```

## PostgreSQL without Docker

The database is optional. It mirrors paper, audit, alerts, stops, and Deadman
state; application state stays in memory, so the server starts and trades fine
without it.

```bash
initdb --auth=trust --locale=C.UTF-8 -D ~/pgdata
pg_ctl -D ~/pgdata -l ~/pgdata.log -o "-p 5433 -k /tmp" start
pg_isready -h 127.0.0.1 -p 5433
```

Apply the schema:

```bash
cd packages/db && DATABASE_URL=postgresql://user@127.0.0.1:5433/indodax bun ./src/migrate.ts
```

Point the server at it:

```bash
DATABASE_URL=postgresql://user@127.0.0.1:5433/indodax bunx -y @indodax-mcp/mcp-http
```

Stop it with `pg_ctl -D ~/pgdata -m fast stop`. Data lives in `~/pgdata` and
survives restarts and unit removal.

## The daemon

The daemon refreshes the market cache and writes portfolio snapshots on an
interval. It is optional operational scaffolding, not a trading engine.

```bash
bunx -y @indodax-mcp/daemon
```

It handles `SIGINT` and `SIGTERM` by stopping its jobs, running shutdown
hooks, and exiting 0. A signal arriving in the first moments of startup, before
the handlers are installed, terminates the process by signal instead. Nothing
is persisted that early, so there is nothing to flush.

## Related pages

- [Self-host operations](../operations/self-host-operations.md): configuration
  reference, safety flags, troubleshooting
- [Beginner guide](beginner.md): paper-only introduction
- [Agent harness guide](agent-harness.md): operating the surface from an agent
- [Operations runbook](../operations/runbook.md): health, database, incidents