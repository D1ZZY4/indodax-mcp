export type DeadmanState = "DISARMED" | "ARMED" | "STALE" | "EXPIRED";

export interface DeadmanStatus {
  state: DeadmanState;
  pairs: string[];
  countdownMs: number | null;
  lastRefreshAt: string | null;
  consecutiveFailures: number;
}

const FAILURE_HALT_THRESHOLD = 3;

export class DeadmanSwitch {
  private status: DeadmanStatus = {
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

  shouldHaltLiveTrading(): boolean {
    return this.status.state === "EXPIRED" || this.status.state === "STALE";
  }

  snapshot(): DeadmanStatus {
    return { ...this.status, pairs: [...this.status.pairs] };
  }
}
