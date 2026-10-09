export type DeadmanState = "DISARMED" | "ARMED" | "STALE" | "EXPIRED";

export * from "@d1zzy4-jethools/indodax-deadman/exchange";

export interface DeadmanStatus {
  state: DeadmanState;
  pairs: string[];
  countdownMs: number | null;
  countdownHuman: string | null;
  lastRefreshAt: string | null;
  consecutiveFailures: number;
}

const FAILURE_HALT_THRESHOLD = 3;

export class DeadmanSwitch {
  private status: Omit<DeadmanStatus, "countdownHuman"> = {
    state: "DISARMED",
    pairs: [],
    countdownMs: null,
    lastRefreshAt: null,
    consecutiveFailures: 0,
  };

  arm(pairs: string[], countdownMs: number): DeadmanStatus {
    if (pairs.length === 0) throw new Error("deadman needs at least one pair");
    if (!Number.isFinite(countdownMs) || countdownMs <= 0) {
      throw new Error("countdown must be positive");
    }
    this.status = {
      state: "ARMED",
      pairs: [...pairs],
      countdownMs,
      lastRefreshAt: new Date().toISOString(),
      consecutiveFailures: 0,
    };
    return this.snapshot();
  }

  recordRefreshSuccess(): DeadmanStatus {
    if (this.status.state === "DISARMED") return this.snapshot();
    this.status = {
      ...this.status,
      state: "ARMED",
      lastRefreshAt: new Date().toISOString(),
      consecutiveFailures: 0,
    };
    return this.snapshot();
  }

  recordRefreshFailure(): DeadmanStatus {
    if (this.status.state === "DISARMED") return this.snapshot();
    const consecutiveFailures = this.status.consecutiveFailures + 1;
    this.status = {
      ...this.status,
      consecutiveFailures,
      state: consecutiveFailures >= FAILURE_HALT_THRESHOLD ? "EXPIRED" : "STALE",
    };
    return this.snapshot();
  }

  disarm(): DeadmanStatus {
    this.status = {
      state: "DISARMED",
      pairs: [],
      countdownMs: null,
      lastRefreshAt: null,
      consecutiveFailures: 0,
    };
    return this.snapshot();
  }

  /**
   * Restart recovery from a persisted snapshot. Unknown shapes throw
   * instead of installing corrupt protection state; a countdown that
   * cannot arm falls back to DISARMED rather than a fake ARMED.
   */
  restore(stored: {
    state: DeadmanState;
    pairs: string[];
    countdownMs: number | null;
  }): DeadmanStatus {
    if (stored.state === "DISARMED") return this.disarm();
    if (
      (stored.state === "ARMED" || stored.state === "STALE" || stored.state === "EXPIRED") &&
      stored.pairs.length > 0 &&
      typeof stored.countdownMs === "number" &&
      Number.isFinite(stored.countdownMs) &&
      stored.countdownMs > 0
    ) {
      this.status = {
        state: stored.state,
        pairs: [...stored.pairs],
        countdownMs: stored.countdownMs,
        lastRefreshAt: null,
        // Exact pre-restart failure counts are unknowable; preserve the
        // ordering invariant instead (STALE below threshold, EXPIRED at it).
        consecutiveFailures:
          stored.state === "ARMED" ? 0 : stored.state === "STALE" ? 1 : FAILURE_HALT_THRESHOLD,
      };
      return this.snapshot();
    }
    throw new Error("stored deadman snapshot has an unexpected shape");
  }

  shouldHaltLiveTrading(): boolean {
    return this.status.state === "EXPIRED" || this.status.state === "STALE";
  }

  snapshot(): DeadmanStatus {
    const base = { ...this.status, pairs: [...this.status.pairs] };
    return { ...base, countdownHuman: formatDuration(base.countdownMs) };
  }
}

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms >= 1_000 && ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}
