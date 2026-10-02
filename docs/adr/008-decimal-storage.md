<h1 align="center">ADR-008: Decimal money with PostgreSQL storage</h1>

- Status: accepted.

## Decision

Use Decimal.js as the authoritative representation for financial arithmetic.

The PostgreSQL schema uses numeric(36,18) for balances, prices, quantities, fees, and PnL values where applicable.

Domain packages depend on repository interfaces rather than direct database connections.

## Consequence

**Floating-point arithmetic must not be introduced** for financial calculations.

The current application composition does not yet make PostgreSQL its runtime source of truth. This ADR defines the persistence boundary, not a claim of completed runtime persistence.
