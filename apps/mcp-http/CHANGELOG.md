# @indodax-mcp/mcp-http

## 2.1.0

### Patch Changes

- Correct published claims in the gateway README, and add runtime MCP
  verification against the packaged stdio binary.
  
  The README still described the server as exposing 91 tools, which was the
  pre-2.0.0 count; the live registry reports 68. It also described
  `GET /health` as returning overall health and persistence state. It returns
  exactly four fields, `status`, `server`, `version`, and `mode`, so it is a
  transport-level liveness probe rather than a component rollup. The README now
  shows the real body and points at `indodax_health`,
  `indodax_runtime_status`, and `indodax_config_status` for component health.
  
  The architecture overview and the completeness matrix also said the workspace
  published at 1.1.1 while every manifest and the registry are at 2.0.0.
  
  New guards keep this from recurring: the surface-count test now checks package
  READMEs as well, and a new runtime suite exercises the packaged binary over a
  real protocol handshake, covering the surface counts, one tool per functional
  category, the typed error envelope, the full paper order lifecycle, and
  startup followed by a clean SIGTERM.
  
  Documentation and test only. No published behaviour differs.
- Updated dependencies
- Updated dependencies
  - @indodax-mcp/mcp-app@2.1.0
  - @indodax-mcp/config@2.1.0
  - @indodax-mcp/logging@2.1.0
  - @indodax-mcp/mcp-runtime@2.1.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @indodax-mcp/mcp-app@2.0.0
  - @indodax-mcp/config@2.0.0
  - @indodax-mcp/logging@2.0.0
  - @indodax-mcp/mcp-runtime@2.0.0
