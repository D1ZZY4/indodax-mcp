# Contributing

## Workflow

1. Read the relevant `docs/architecture` page before changing boundaries.
2. Add or update an ADR in `docs/adr` for material decisions.
3. Keep each file under 350 lines; hard limit is 375 lines.
4. Run `cargo fmt --all`, `cargo check`, `cargo test`, `cargo clippy`.
5. Cover failure paths, not only happy paths.
6. Never log secrets.

## Boundaries

* MCP handlers stay thin: deserialize, validate, call service, serialize.
* Strategy emits intents; risk decides; execution performs.
* No live order path may bypass risk or capability checks.
