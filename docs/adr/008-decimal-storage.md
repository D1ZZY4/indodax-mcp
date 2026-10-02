# ADR-008: Decimal money with Drizzle PostgreSQL storage

* Status: accepted.
* Decision: `decimal.js` is authoritative for all money math;
  PostgreSQL `numeric(36,18)` columns via Drizzle hold balances,
  prices, quantities, fees, and PnL. Domain depends on repository
  interfaces, never on Drizzle connections.
* Rationale: float arithmetic cannot represent exchange decimals
  exactly; the database must preserve the same precision.
* Consequence: `packages/db` owns schema plus migrations; local
  dev and tests run real PostgreSQL binaries via
  `embedded-postgres` behind the same driver.
