# Contributing

## Workflow

1. Read the relevant `docs/architecture` page before moving a boundary.
2. Record material decisions in `docs/adr`.
3. Keep each file at or under 350 lines. 375 is a hard ceiling.
4. Run `cargo fmt --all`, `cargo check`, `cargo test`, `cargo clippy`.
5. Test failure paths, not only happy paths.
6. Never log secrets. Grep for key material before committing.

## Boundaries

* MCP handlers stay thin: deserialize, validate, call service, serialize.
* Strategy emits intents. Risk decides. Execution performs.
* No live order path bypasses risk or capability checks.
* Storage goes through repository traits, not inline SQL or ad-hoc files.
