import { describe, expect, it } from "vitest";
import type { FetchFn } from "@indodax-mcp/transport";
import { DEADMAN_V1_BASE, requestDeadmanCountdown } from "@indodax-mcp/indodax-deadman/exchange";

function stubFetch(body: unknown): FetchFn {
  return (async () => new Response(JSON.stringify(body))) as FetchFn;
}

describe("deadman exchange heartbeat", () => {
  it("posts a signed countdown to the v1 tapi endpoint", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody = "";
    const fetchFn = (async (input: string, init?: RequestInit) => {
      seenUrl = String(input);
      seenHeaders = { ...((init?.headers ?? {}) as Record<string, string>) };
      seenBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ success: 1 }));
    }) as FetchFn;
    await requestDeadmanCountdown(
      "KEY123",
      "SECRET123",
      {
        pairs: ["btc_idr", "eth_idr"],
        countdownMs: 120000,
      },
      fetchFn,
      1700000000000,
    );
    expect(seenUrl).toBe(`${DEADMAN_V1_BASE}`);
    expect(seenHeaders.Key).toBe("KEY123");
    expect(seenHeaders.Sign).toMatch(/^[0-9a-f]{128}$/);
    expect(seenBody).toContain("pair=btc_idr%2Ceth_idr");
    expect(seenBody).toContain("countdownTime=120000");
  });

  it("surfaces exchange rejections without leaking secrets", async () => {
    await expect(
      requestDeadmanCountdown(
        "K",
        "S",
        { pairs: ["btc_idr"], countdownMs: 1000 },
        stubFetch({
          success: 0,
          error: "Invalid pair",
          error_code: "bad_request",
        }),
      ),
    ).rejects.toThrow(/Invalid pair/);
    await expect(
      requestDeadmanCountdown(
        "K",
        "S",
        { pairs: ["btc_idr"], countdownMs: 1000 },
        stubFetch({
          nope: true,
        }),
      ),
    ).rejects.toThrow(/rejected/);
  });

  it("validates pairs and countdown before signing", async () => {
    const ok = stubFetch({ success: 1 });
    await expect(
      requestDeadmanCountdown("K", "S", { pairs: [], countdownMs: 1 }, ok),
    ).rejects.toThrow();
    await expect(
      requestDeadmanCountdown("K", "S", { pairs: ["btc_idr"], countdownMs: -1 }, ok),
    ).rejects.toThrow();
    await requestDeadmanCountdown("K", "S", { pairs: ["btc_idr"], countdownMs: 0 }, ok);
  });
});
