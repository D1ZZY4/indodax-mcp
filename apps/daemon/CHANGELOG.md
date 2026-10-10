# @indodax-mcp/daemon

## 2.1.0

### Patch Changes

- Handle a stop signal that arrives during boot.
  
  The daemon registered its SIGINT and SIGTERM handlers inside `main()`, after
  the module graph had been composed. Composing the application takes roughly
  190ms on a cold start, so a signal landing in that window killed the process
  by default disposition: exit 143, no shutdown hooks, and no clean-exit log
  line. A container stop or a systemd `TimeoutStopSec` firing during boot is
  exactly the case where the shutdown path has to work.
  
  Handlers are now installed through a runtime preload, and a signal arriving
  before `main` registers the real routine is recorded and replayed, so a stop
  request is honoured at any point in the boot sequence rather than being lost.
  
  The published binary is now `dist/indodax-daemon`, a small launcher that
  passes `--preload` with a path resolved from its own directory. This is what
  makes the fix work from a global install: a shebang cannot carry the flag,
  because `#!/usr/bin/env bun --preload x` makes env look for a program
  literally named `bun --preload x`, and `bunfig.toml` cannot do it either,
  because Bun resolves that file against the working directory rather than the
  package directory. The `indodax-daemon` command is unchanged, and
  `dist/index.js` still ships with its shebang.
- Updated dependencies
- Updated dependencies
  - @indodax-mcp/mcp-app@2.1.0
  - @indodax-mcp/config@2.1.0
  - @indodax-mcp/core@2.1.0
  - @indodax-mcp/indodax-market@2.1.0
  - @indodax-mcp/logging@2.1.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @indodax-mcp/mcp-app@2.0.0
  - @indodax-mcp/config@2.0.0
  - @indodax-mcp/core@2.0.0
  - @indodax-mcp/indodax-market@2.0.0
  - @indodax-mcp/logging@2.0.0
