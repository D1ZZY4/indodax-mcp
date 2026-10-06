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
}

const report: PersistenceReport = {
  configured: false,
  state: "unconfigured",
  mirrors: [],
  since: new Date().toISOString(),
  lastError: null,
  degraded: false,
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
}

/** Called once every mirror attaches successfully. */
export function noteConnected(): void {
  report.state = "connected";
  report.degraded = false;
  report.lastError = null;
}

export function noteFailure(cause: string): void {
  report.state = "failed";
  report.degraded = true;
  report.lastError = cause.slice(0, 200);
}

export function persistenceReport(): PersistenceReport {
  return { ...report, mirrors: [...report.mirrors] };
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
 * A failed write is the only reliable evidence, so the state is re-evaluated
 * whenever one is seen and until then it stays as observed.
 */
let lastWriteFailed = false;
let lastWriteOk = false;

export function noteWriteOutcome(ok: boolean): void {
  if (ok) {
    lastWriteOk = true;
    lastWriteFailed = false;
    return;
  }
  lastWriteFailed = true;
}

/** Refresh from the latest write evidence without clearing a known failure. */
export function refreshPersistenceState(): PersistenceReport {
  if (lastWriteFailed) return persistenceReport();
  if (lastWriteOk && report.state === "failed") {
    report.state = "connected";
    report.degraded = false;
    report.lastError = null;
  }
  return persistenceReport();
}
