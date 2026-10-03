import { describe, expect, it } from "vitest";
import { type FetchFn, fetchWithRetry } from "../src/fetch.js";
import { RateLimiter } from "../src/rate-limit.js";
import { isAppError } from "@indodax-mcp/errors";

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
