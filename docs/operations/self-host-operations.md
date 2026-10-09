<h1 align="center">Self-host operations</h1>

Reference for running an installed or self-hosted server: every environment
variable, what the safety flags actually do, and how to diagnose a setup that
is not behaving. See [Self-hosting guide](../guides/self-hosting.md) for how to
install it in the first place.

## Configuration reference

Every variable the server reads, and what happens when it is absent.

| Variable | Default | Effect |
| --- | --- | --- |
| `APP_ENV` | `paper` | `development`, `paper`, or `live`. Anything but `live` cannot reach the live backend. |
| `TRADE_ENABLED` | unset | Required **in addition** to `APP_ENV=live`. Neither alone enables live. |
| `INDODAX_API_KEY` | unset | Enables authenticated reads. |
| `INDODAX_API_SECRET` | unset | Enables authenticated reads. |
| `WITHDRAW_ENABLED` | unset | **Has no effect.** See the safety section. |
| `DATABASE_URL` | unset | Attaches the persistence mirrors. Without it they stay in memory. |
| `MCP_HOST` | `127.0.0.1` | HTTP bind address. |
| `MCP_PORT` | `8000` | HTTP port. |
| `STOP_AUTOPOLL_MS` | unset | Stop evaluation interval, in milliseconds. |
| `ALERT_AUTOPOLL_MS` | unset | Alert evaluation interval, in milliseconds. |

### Two names that do not exist

**`MCP_HTTP_PORT` and `MCP_HTTP_HOST` are not read by anything.** Setting them
changes nothing while the server stays on its default `127.0.0.1:8000`, which
reads as "my setting is ignored". The correct names are `MCP_PORT` and
`MCP_HOST`.

This is worth stating because the mistake is easy to make and the failure is
silent rather than loud.

### Where configuration can come from

Values are read from the process environment first, then from a repository
`.env` found by walking up from the package. Explicit process environment wins
over file values.

Use `indodax_config_status` to see which channel supplied each credential. It
reports `process-env`, `repo-env-file`, or `absent` per value and **never
prints a secret**. That is the fastest way to settle "I exported this but the
process never saw it".

## Safety, and what the flags actually do

### Paper is the default

No flags required. `APP_ENV` defaults to `paper`, and the simulator is the
supported trading mode.

### Live placement needs all of these

```bash
APP_ENV=live
TRADE_ENABLED=true
INDODAX_API_KEY=...
INDODAX_API_SECRET=...
```

plus, **per individual call**:

- `acknowledged: true` in the tool arguments
- a risk ALLOW verdict from the deterministic engine

Check the current state with `indodax_capabilities`:

```text
liveGate.satisfied   whether the environment half is met
trade.place          whether placement is possible at all
```

Treat `liveGate.satisfied: false` as a closed path, not as a missing tool.

### Withdrawal is denied by design

`WITHDRAW_ENABLED` exists so the variable list looks symmetric with the others.
**It is not wired to anything.** There is no server-side grant path, and no
combination of flags enables one. Calling the tool returns:

```text
AuthorizationError: funding.withdraw is disabled and needs a separate grant
```

This is intentional and should stay that way. A withdrawal capability added to
an MCP server is reachable by any agent that can talk to it.

### Modes that are not live

| Mode | Execution backend | Use for |
| --- | --- | --- |
| `development` | none | schema and contract work |
| `paper` | simulator | the supported trading mode |
| `live` | exchange, gated | deliberate, supervised use |

`shadow` and `development` both refuse to reach a backend, so a proposal cannot
quietly become an order.

## Operating it

### Health and diagnostics

All read-only, none of them mutate anything:

```bash
indodax system health        # component rollup
indodax risk limits          # the deterministic limits in force
indodax risk state           # policy, Deadman state, credential origin
```

Over MCP: `indodax_health` (add `readiness: true` for the serve verdict),
`indodax_runtime_status`, `indodax_config_status`.

### Two habits worth forming early

**Check `indodax_config_status` first** whenever a credential seems missing. It
names the channel each value came from, which removes the guesswork.

**Read `indodax_reconcile_paper` with `scope: "state"` before trusting a
balance.** A healthy process does not mean its in-memory state matches the
exchange. This is the check that catches a duplicate or phantom order before it
becomes a real one.

### Handling an ambiguous outcome

A state-changing request whose outcome is unknown is reported as
`UnknownExecutionResultError`, which is **not retryable**. Do not resubmit it.

Preserve the client order id and the correlation id, read authoritative exchange
state, then decide. The reconcile tools are not yet a complete exchange
reconciliation workflow, so confirm independently before acting.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Client starts the server, then errors immediately | Wrong config shape. OpenCode needs a `command` array plus `environment`; Claude Desktop needs `command` plus `args` plus `env`. |
| Credentials are set but reads are refused | The process never inherited them. Confirm with `indodax_config_status`. |
| `bunx` works by hand but the service does not | A user service has a minimal `PATH`. Use the absolute Bun path in `ExecStart`. |
| `MCP_HTTP_PORT` seems ignored | It does not exist. Use `MCP_PORT`. |
| A source change has no effect | `bunx` runs the published package. Use a checkout, or pin the version. |
| Persistence reports configured but unreachable | The process is missing `DATABASE_URL`, or migrations never ran. Read the per-store detail in `indodax_config_status`. |
| One mirror fails while others report connected | Expected. Each store keeps its own evidence, so read the failing store by name rather than a single verdict. |
| Stops or alerts vanish after a restart | The server process is missing `DATABASE_URL`, not a code fault. |
| Gateway will not start against a fresh database volume | Migrations have not run. Compose handles this with the `migrate` service; standalone, run `packages/db/src/migrate.ts` first. |
| Compose gateway is unreachable from the host | `MCP_HOST=0.0.0.0` is required inside the container. Container loopback is not reachable from the bridge. |
| A test suite times out rather than failing | Usually a suite that reaches the live exchange. Substitute `app.publicClient` with a fixed price instead. |

## Rotating credentials

1. Create the new key in INDODAX.
2. Update the environment where the server actually runs, which is not
   necessarily where you typed the command.
3. Restart the server and any long-running daemon.
4. Call `indodax_config_status` and confirm the origin reads `process-env`.
5. Call `indodax_account` with read-only access.
6. Revoke the old key.

**Never place an order as a credential test.** A read is enough to prove the key
works, and an order proves it with real funds.

## Related pages

- [Self-hosting guide](../guides/self-hosting.md): install shapes and deployment
- [Operations runbook](runbook.md): health, database, incident handling
- [Trading modes](../trading/modes.md): paper, live, readiness boundary
- [Risk policy](../risk/policy.md): deterministic limits and their limits
- [Security](../../SECURITY.md): disclosure and reporting