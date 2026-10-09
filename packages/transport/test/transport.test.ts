import { describe, expect, it } from "vitest";
import { type FetchFn, fetchWithRetry } from "@d1zzy4-jethools/transport/fetch";
import {
  OFFICIAL_PUBLIC_BUCKET,
  OFFICIAL_V2_BUCKET,
  RateLimiter,
  appThrottleBucket,
} from "@d1zzy4-jethools/transport/rate-limit";
import { isAppError } from "@d1zzy4-jethools/errors";

describe("fetchWithRetry", () => {
  it("returns first successful response", async () => {
    const response = await fetchWithRetry(
      "https://example.com/x",
      {},
      undefined,
      (async () => new Response("ok")) as FetchFn,
    );
    expect(await response.text()).toBe("ok");
  });

  it("retries 429 then succeeds", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return calls === 1 ? new Response("slow", { status: 429 }) : new Response("ok");
    }) as FetchFn;
    const response = await fetchWithRetry(
      "https://example.com/x",
      {},
      { maxAttempts: 3, baseDelayMs: 1, timeoutMs: 5000 },
      fetchFn,
    );
    expect(await response.text()).toBe("ok");
  });

  it("maps exhausted 429 to rate limit error", async () => {
    const fetchFn = (async () => new Response("slow", { status: 429 })) as FetchFn;
    const failure = await fetchWithRetry(
      "https://example.com/x",
      {},
      { maxAttempts: 2, baseDelayMs: 1, timeoutMs: 5000 },
      fetchFn,
    ).catch((error: unknown) => error);
    expect(isAppError(failure)).toBe(true);
  });

  it("does not retry 400", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response("bad", { status: 400 });
    }) as FetchFn;
    await expect(
      fetchWithRetry(
        "https://example.com/x",
        {},
        { maxAttempts: 3, baseDelayMs: 1, timeoutMs: 5000 },
        fetchFn,
      ),
    ).rejects.toThrow(/unexpected HTTP 400/);
    expect(calls).toBe(1);
  });

  it("attempts state-changing POST exactly once by default", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response("slow", { status: 429 });
    }) as FetchFn;
    await expect(
      fetchWithRetry(
        "https://example.com/x",
        { method: "POST", body: "a=b" },
        { maxAttempts: 3, baseDelayMs: 1, timeoutMs: 5000 },
        fetchFn,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("retries state-changing POST when the caller opts into idempotent retry", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return calls === 1 ? new Response("slow", { status: 429 }) : new Response("ok");
    }) as FetchFn;
    const response = await fetchWithRetry(
      "https://example.com/x",
      { method: "POST", body: "a=b" },
      { maxAttempts: 3, baseDelayMs: 1, timeoutMs: 5000, retryStateChanging: true },
      fetchFn,
    );
    expect(await response.text()).toBe("ok");
    expect(calls).toBe(2);
  });

  it("lets a signed caller rebuild url and headers per attempt", async () => {
    const seen: { url: string; sign: string }[] = [];
    let calls = 0;
    const fetchFn = (async (input: string, init?: RequestInit) => {
      calls += 1;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url: String(input), sign: String(headers.Sign) });
      return calls === 1 ? new Response("slow", { status: 503 }) : new Response("ok");
    }) as FetchFn;
    const response = await fetchWithRetry(
      "https://example.com/placeholder",
      {},
      { maxAttempts: 3, baseDelayMs: 1, timeoutMs: 5000 },
      fetchFn,
      (attempt) => {
        const query = `timestamp=${1000 + attempt * 1000}`;
        return {
          url: `https://example.com/x?${query}`,
          init: { headers: { Sign: `sig-${query}` } },
        };
      },
    );
    expect(await response.text()).toBe("ok");
    expect(calls).toBe(2);
    // Each attempt must carry its own signature, otherwise a retry replays an
    // expired one and the exchange rejects it as a timestamp error.
    expect(seen[0]?.sign).not.toBe(seen[1]?.sign);
    expect(seen[1]?.url).toContain("timestamp=3000");
  });

  it("does not reuse a placeholder signature when no builder is supplied", async () => {
    const seen: string[] = [];
    let calls = 0;
    const fetchFn = (async (_input: string, init?: RequestInit) => {
      calls += 1;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push(String(headers.Sign));
      return calls === 1 ? new Response("slow", { status: 503 }) : new Response("ok");
    }) as FetchFn;
    await fetchWithRetry(
      "https://example.com/x",
      { headers: { Sign: "static" } },
      { maxAttempts: 2, baseDelayMs: 1, timeoutMs: 5000 },
      fetchFn,
    );
    expect(seen).toEqual(["static", "static"]);
  });
});

describe("RateLimiter", () => {
  it("enforces capacity then reports reset", () => {
    const limiter = new RateLimiter([{ key: "k", capacity: 2, refillPerSecond: 1 }]);
    expect(limiter.tryAcquire("k", 0).allowed).toBe(true);
    expect(limiter.tryAcquire("k", 0).allowed).toBe(true);
    const third = limiter.tryAcquire("k", 0);
    expect(third.allowed).toBe(false);
    expect(third.resetInMs).toBeGreaterThan(0);
    expect(third.reason).toContain("k");
  });

  it("refills over time", () => {
    const limiter = new RateLimiter([{ key: "k", capacity: 1, refillPerSecond: 1 }]);
    expect(limiter.tryAcquire("k", 0).allowed).toBe(true);
    expect(limiter.tryAcquire("k", 2000).allowed).toBe(true);
  });
});

describe("officially bounded buckets", () => {
  it("keeps shared TAPI v2 traffic under the documented per-user order rule", () => {
    // The public create-order rule is 20/s per user per pair. The bucket is a
    // single conservative ceiling below that, so all private traffic stays
    // under known limits by default.
    expect(OFFICIAL_V2_BUCKET.refillPerSecond).toBeLessThan(20);
    expect(OFFICIAL_V2_BUCKET.capacity).toBeLessThanOrEqual(OFFICIAL_V2_BUCKET.refillPerSecond);
  });

  it("keeps public traffic within the published 180 per minute quota", () => {
    expect(OFFICIAL_PUBLIC_BUCKET.refillPerSecond * 60).toBeLessThanOrEqual(180);
  });

  it("never throttles below one request per second", () => {
    expect(appThrottleBucket(0).refillPerSecond).toBe(1);
    expect(appThrottleBucket(-5).capacity).toBe(1);
  });
});
