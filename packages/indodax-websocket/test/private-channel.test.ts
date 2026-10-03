import { describe, expect, it, vi } from "vitest";
import {
  PrivateChannelManager,
  needsRefresh,
  reconnectDelayMs,
  tokenAgeMs,
  REFRESH_MARGIN_MS,
  TOKEN_TTL_MS,
  type PrivateToken,
} from "../src/private-channel.js";

function token(issuedAtMs: number): PrivateToken {
  return { token: "t", channel: "pws:#x", issuedAtMs };
}

describe("private channel refresh", () => {
  it("requires a token when none exists", () => {
    expect(needsRefresh(null, 1_000)).toBe(true);
  });

  it("keeps a fresh token without refresh", () => {
    expect(needsRefresh(token(1_000), 2_000)).toBe(false);
  });

  it("refreshes ahead of expiry inside the margin", () => {
    const issued = 0;
    const almostExpired = TOKEN_TTL_MS - REFRESH_MARGIN_MS + 1_000;
    expect(needsRefresh(token(issued), almostExpired)).toBe(true);
  });

  it("detects expired tokens", () => {
    expect(needsRefresh(token(0), TOKEN_TTL_MS + 1)).toBe(true);
  });

  it("measures token age without going negative", () => {
    expect(tokenAgeMs(token(1_000), 2_500)).toBe(1_500);
    expect(tokenAgeMs(token(5_000), 1_000)).toBe(0);
  });
});

describe("private channel backoff", () => {
  it("starts at the base delay and doubles", () => {
    expect(reconnectDelayMs(0, 1_000, 30_000)).toBe(1_000);
    expect(reconnectDelayMs(1, 1_000, 30_000)).toBe(2_000);
    expect(reconnectDelayMs(2, 1_000, 30_000)).toBe(4_000);
  });

  it("caps the delay at the maximum", () => {
    expect(reconnectDelayMs(100, 1_000, 30_000)).toBe(30_000);
  });

  it("falls back to base for negative attempts", () => {
    expect(reconnectDelayMs(-1, 1_000, 30_000)).toBe(1_000);
  });
});

describe("private channel manager", () => {
  it("fetches a token on first ensureFresh", async () => {
    const manager = new PrivateChannelManager({ onEvent: () => {} });
    expect(manager.tokenAge(1_000)).toBeNull();
    const fetchToken = vi.fn(async () => ({ token: "abc", channel: "pws:#c" }));
    expect(await manager.ensureFresh(fetchToken, 1_000)).toBe(true);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(manager.channel).toBe("pws:#c");
    expect(manager.tokenAge(2_000)).toBe(1_000);
  });

  it("skips fetch while the token stays fresh", async () => {
    const manager = new PrivateChannelManager({ onEvent: () => {} });
    const fetchToken = vi.fn(async () => ({ token: "abc", channel: "pws:#c" }));
    await manager.ensureFresh(fetchToken, 1_000);
    expect(await manager.ensureFresh(fetchToken, 2_000)).toBe(false);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("tracks failures and stops reconnecting after disconnect", async () => {
    const manager = new PrivateChannelManager({ onEvent: () => {} });
    manager.recordFailure();
    manager.recordFailure();
    expect(manager.consecutiveFailures).toBe(2);
    manager.disconnect();
    const fetchToken = vi.fn(async () => ({ token: "abc", channel: "pws:#c" }));
    expect(await manager.reconnect(fetchToken)).toBe(0);
    expect(fetchToken).not.toHaveBeenCalled();
  });
});
