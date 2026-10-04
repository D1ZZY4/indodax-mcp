<h1 align="center">Documentation</h1>

This documentation describes the **current implementation** of Indodax MCP. Status claims should be read together with the completeness matrix; **package-level code does not automatically mean** that a capability is wired into the main runtime.

## Start here

- [Repository README](../README.md): project status, installation, quickstart, and high-level safety model.
- [Beginner guide](guides/beginner.md): paper-only introduction.
- [Agent harness guide](guides/agent-harness.md): operating the MCP from an AI agent.
- [Developer guide](guides/developer.md): package boundaries and extension rules.
- [Advanced guide](guides/advanced.md): operator workflows and current readiness limits.

## Architecture

- [Architecture overview](architecture/overview.md): package layers and runtime composition.
- [Execution flow](architecture/execution.md): validation, risk review, execution, and unknown outcomes.
- [Completeness matrix](architecture/completeness.md): implemented, wired, tested, and end-to-end status.

## MCP

- [MCP surface](mcp/surface.md): tools, resources, prompts, transports, and safety boundaries.
- [MCP tool implementation](mcp/tools.md): handler design and response contracts.
- [Tool guides](tools/README.md): per-area agent-harness pages with full parameters, also served at runtime via `indodax_docs`.

## Exchange and risk

- [API mapping](api/mapping.md): current INDODAX REST and TAPI v2 mapping.
- [Risk policy](risk/policy.md): deterministic rules, limits, and runtime limitations.
- [Trading modes](trading/modes.md): paper, live, shadow, and live-readiness boundary.
- [Operations runbook](operations/runbook.md): health, runtime checks, and credential rotation.

## Migration and decisions

- [Rust to TypeScript](migration/rust-to-typescript.md): responsibility mapping from the original Rust implementation.
- [Migration reconstruction](migration/recon.md): historical behavior inventory.
- [v1 to v2](migration/v1-to-v2.md): migration record and intentional deltas.
- [Risk register](migration/risk-register.md): known implementation and environment risks.
- [Dependency compatibility](migration/dependency-compatibility.md): verified dependency snapshot.
- [Deviations](migration/deviations.md): decisions where the build environment or current ecosystem differs from earlier requirements.
- [ADR index](adr/006-bun-monorepo.md): architecture decisions, with historical ADRs explicitly marked.

## References

- [Upstream source references](references/sources.md): official INDODAX documentation and supporting sources.

## Documentation rules

Documentation must distinguish implementation, wiring, automated coverage, end-to-end verification, and blocked or planned behavior. When code and documentation disagree, **verify the code** and update the documentation instead of masking the discrepancy.
