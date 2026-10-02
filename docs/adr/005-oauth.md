# ADR-005: HTTP auth without v1 OAuth flow

> Historical record from the Rust workspace. The bridge-secret model
> carries over to `apps/mcp-http`.

* Status: accepted.
* Decision: the gateway authenticates bridge calls with an optional
  `BRIDGE_SECRET` header plus process-env credentials, instead of
  porting the v1 OAuth Authorization-Code + PKCE browser flow. Rationale:
  this platform has no browser UX, the bridge is single-operator, and a
  full authorization server would add unaudited attack surface for no
  functional gain. The v1 flow is documented here as intentionally not
  ported, not accidentally dropped.
* Consequence: ChatGPT-style third-party OAuth connectors are out of
  scope until a real multi-user requirement exists.
