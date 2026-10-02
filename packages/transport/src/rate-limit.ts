export type RateLimitDimension = "ip" | "account" | "endpointClass" | "pair" | "operation";

export interface BucketSpec {
  key: string;
  capacity: number;
  refillPerSecond: number;
}

export interface AcquireResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  reason?: string;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export class RateLimiter {
  private readonly states = new Map<string, BucketState>();
  private readonly specs = new Map<string, BucketSpec>();

  constructor(specs: BucketSpec[] = []) {
    for (const spec of specs) this.specs.set(spec.key, spec);
  }

  addBucket(spec: BucketSpec): void {
    this.specs.set(spec.key, spec);
  }

  private refill(key: string, nowMs: number): BucketState {
    const spec = this.specs.get(key);
    if (!spec) throw new Error(`unknown rate limit bucket: ${key}`);
    let state = this.states.get(key);
    if (!state) {
      state = { tokens: spec.capacity, lastRefillMs: nowMs };
      this.states.set(key, state);
      return state;
    }
    const elapsedSec = Math.min(60, Math.max(0, (nowMs - state.lastRefillMs) / 1000));
    state.tokens = Math.min(spec.capacity, state.tokens + elapsedSec * spec.refillPerSecond);
    state.lastRefillMs = nowMs;
    return state;
  }

  tryAcquire(key: string, nowMs: number = Date.now()): AcquireResult {
    const spec = this.specs.get(key);
    if (!spec) throw new Error(`unknown rate limit bucket: ${key}`);
    const state = this.refill(key, nowMs);
    if (state.tokens >= 1) {
      state.tokens -= 1;
      return { allowed: true, remaining: Math.floor(state.tokens), resetInMs: 0 };
    }
    const deficit = 1 - state.tokens;
    const resetInMs = Math.ceil((deficit / spec.refillPerSecond) * 1000);
    return { allowed: false, remaining: 0, resetInMs, reason: `bucket ${key} exhausted` };
  }

  async acquire(key: string): Promise<AcquireResult> {
    for (;;) {
      const result = this.tryAcquire(key);
      if (result.allowed) return result;
      await new Promise((resolve) => setTimeout(resolve, Math.max(10, result.resetInMs)));
    }
  }

  remaining(key: string): number {
    const state = this.states.get(key);
    if (!state) return this.specs.get(key)?.capacity ?? 0;
    return Math.floor(state.tokens);
  }
}

export const OFFICIAL_PUBLIC_BUCKET: BucketSpec = {
  key: "public-rest",
  capacity: 180,
  refillPerSecond: 3,
};

/**
 * Conservative shared bucket for authenticated TAPI v2 calls.
 * Set below the documented create-order rule (20/s per user per pair)
 * so all private traffic stays under known limits by default.
 */
export const OFFICIAL_V2_BUCKET: BucketSpec = {
  key: "v2-rest",
  capacity: 10,
  refillPerSecond: 10,
};

export function appThrottleBucket(requestsPerSecond: number): BucketSpec {
  const rps = Math.max(1, Math.floor(requestsPerSecond));
  return { key: "app-throttle", capacity: rps, refillPerSecond: rps };
}
