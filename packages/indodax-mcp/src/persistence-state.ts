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
