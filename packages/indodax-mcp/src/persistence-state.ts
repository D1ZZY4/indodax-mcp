/**
 * Honest persistence reporting.
 *
 * The database mirror is memory-first: an unreachable Postgres never breaks
 * trading, it only means a restart cannot restore state. That silence was the
 * real defect behind a field report where stops vanished after a restart while
 * the server still reported `database: configured`.
 *
 * Reporting the presence of DATABASE_URL is not reporting durability. This
 * module tracks what actually happened on the connection so the health and
 * config surfaces can name the difference between a configured mirror, a
 * reachable one, and one that has been failing since boot.
 */

export type PersistenceState = "unconfigured" | "connected" | "failed";

export interface PersistenceReport {
  /** What DATABASE_URL says, which is not the same as durability. */
  configured: boolean;
  /** What the connection actually did. */
  state: PersistenceState;
  /** Stores that mirror when the database is reachable. */
  mirrors: string[];
  /** Boot time of the server, used to describe how long a failure has lasted. */
  since: string;
  /** Last observed failure cause, truncated and free of credentials. */
  lastError: string | null;
  /**
   * True when a mirror was configured but never became reachable, which is the
   * state that silently lost stops on restart.
   */
  degraded: boolean;
  /**
   * Per-store outcome, so one store cannot speak for the others.
   *
   * The report is a rollup of independent mirrors, and a rollup that any
   * single success can clear is not honest: a working audit append used to
   * erase a stops mirror that had never attached, which is exactly the restart
   * data loss this module exists to report.
   */
  stores: Record<string, "unknown" | "connected" | "failed">;
}

const report: PersistenceReport = {
  configured: false,
  state: "unconfigured",
  mirrors: [],
  since: new Date().toISOString(),
  lastError: null,
  degraded: false,
  stores: {},
};

export function noteConfigured(mirrors: string[]): void {
  report.configured = true;
  report.mirrors = mirrors;
  report.degraded = true;
  if (report.state !== "connected") report.state = "failed";
}

export function noteUnconfigured(): void {
  report.configured = false;
  report.state = "unconfigured";
  report.degraded = false;
  report.lastError = null;
  report.stores = {};
}

/** Promote the rollup. Only reachable once no store is failing. */
function noteConnected(): void {
  report.state = "connected";
  report.degraded = false;
  report.lastError = null;
}

function noteFailure(cause: string): void {
  report.state = "failed";
  report.degraded = true;
  report.lastError = cause.slice(0, 200);
}

/** Defensive copy so a caller cannot mutate the module state it reads. */
function persistenceReport(): PersistenceReport {
  return { ...report, mirrors: [...report.mirrors], stores: { ...report.stores } };
}

/**
 * A mirror that connected once does not prove it is connected now.
 *
 * The pool keeps established sockets alive, so a database that dies after
 * boot leaves every write succeeding against a server that is gone until the
 * pool happens to recycle the socket. Reporting the connection state captured
 * at boot therefore reported a durable mirror while nothing was being written,
 * which is the failure this module exists to prevent.
 *
 * A failed write is the only reliable evidence, so each store keeps its own
 * last outcome and the rollup is derived from those, never from a shared flag.
 * A single shared flag let the first successful write clear a failure that
 * belonged to a different store.
 */

/** Record a write outcome for one named mirror. */
export function noteWriteOutcome(store: string, ok: boolean): void {
  report.stores[store] = ok ? "connected" : "failed";
  if (ok) return;
  noteFailure("mirror write failed");
}

/** Record that one named mirror attached to the database. */
export function noteStoreConnected(store: string): void {
  report.stores[store] = "connected";
  // Only promote the rollup when no store is failing. The first store to
  // attach says nothing about the stores that have not reported yet, so the
  // rollup waits for the boot sequence to finish rather than claiming
  // durability from a single connection.
  if (!anyStoreFailed()) noteConnected();
}

/** Record that one named mirror failed to attach or failed to write. */
export function noteStoreFailure(store: string, cause: string): void {
  report.stores[store] = "failed";
  noteFailure(cause);
}

function anyStoreFailed(): boolean {
  return Object.values(report.stores).some((state) => state === "failed");
}

/**
 * Re-derive the rollup from per-store evidence.
 *
 * A store still marked failed keeps the rollup failed even when another store
 * writes successfully, because a restart would lose only the first store's
 * state while the report claimed everything was mirrored. The rollup clears
 * once every store that reported a failure has written successfully again.
 */
export function refreshPersistenceState(): PersistenceReport {
  if (report.state === "failed" && !anyStoreFailed()) {
    report.state = "connected";
    report.degraded = false;
    report.lastError = null;
  }
  return persistenceReport();
}
