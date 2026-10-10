# @indodax-mcp/cli

## 2.1.0

### Patch Changes

- Stop test and verification entrypoints from attaching to the host database.
  
  Four subprocess spawns inherited the ambient environment, so `DATABASE_URL`
  reached the child. Every spawned server that sees it attaches all five
  persistence mirrors on boot, which meant a test run wrote to whatever database
  the developer had configured and made startup depend on that server's
  latency.
  
  The latency half was not theoretical: the daemon suite waits for
  "daemon ready", logged after its live market reads. With five mirrors to
  attach first, that pushed the line past the wait window under parallel suite
  load and failed intermittently. The suite passed alone and failed inside a
  full run.
  
  `DATABASE_URL` is now cleared in the spawned environment for the daemon
  suite, both HTTP gateway specs, and the consumer verification script. None of
  these paths need a database: they cover start, schedule, stop, transport,
  identity, and whether a packed artifact serves.
  
  Test-only change. No published behaviour differs.

## 2.0.0

No changes in this release.
