# Deviations

This page records material differences between earlier build requirements and the current repository.

| Area | Requested or expected | Current state | Reason | Impact |
| --- | --- | --- | --- | --- |
| MCP protocol | 2026-07-28 | 2025-11-25 negotiated | Current installed SDK 2.2.0 supports 2025-11-25 as the available protocol maximum in this build | Current clients use the negotiated version |
| TypeScript | latest stable | 5.9 line | TypeScript 7.x was treated as a preview/native-preview line during the compatibility snapshot | Toolchain stability |
| Vite React plugin | earlier v5 expectation | v6 line | Vite 8 compatibility requires the newer plugin line | No functional regression |
| PostgreSQL service | system PostgreSQL | embedded PostgreSQL for dev/test where needed | Build environment may not provide a local PostgreSQL service | Development setup only |
| SQLite convenience path | allowed alternative | not used | Repository targets PostgreSQL semantics and schema | No SQLite compatibility layer |
| Redis/job extras | optional architecture | not installed by default | Current scheduler does not require an external queue | Smaller operational surface |
| OAuth browser server | earlier Rust feature | not ported | Current HTTP application is a local bridge without the old browser OAuth flow | No browser-based OAuth surface |

## Decision rule

A deviation is acceptable only when it is explicit, evidenced, and reflected in tests or documentation.

Do not silently convert a requested feature into a different behavior without recording the difference here.
