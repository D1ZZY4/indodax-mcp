export type DeadmanState = "DISARMED" | "ARMED" | "STALE" | "EXPIRED";

export * from "./exchange.js";

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
