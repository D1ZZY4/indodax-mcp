import { describe, expect, it } from "vitest";
import type { FetchFn } from "@indodax-mcp/transport";
import { PublicClient } from "@indodax-mcp/indodax-client/public-client";

function stubFetch(routes: Record<string, unknown>): FetchFn {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return new Response(JSON.stringify(body));
    }
    return new Response("missing", { status: 404 });
  }) as FetchFn;
}

const TICKER = {
  ticker: { high: "110", low: "90", last: "100", buy: "99", sell: "101", server_time: 123 },
};

describe("PublicClient", () => {
  it("validates ticker shape", async () => {
    const client = new PublicClient({
      fetchFn: stubFetch({ "/api/ticker/btc_idr": TICKER }),
    });
    const ticker = await client.ticker("btc_idr");
    expect(ticker.last).toBe("100");
  });

  it("rejects malformed payloads", async () => {
    const client = new PublicClient({
      fetchFn: stubFetch({ "/api/ticker/btc_idr": { nope: true } }),
    });
    await expect(client.ticker("btc_idr")).rejects.toThrow();
  });

  it("builds OHLC query params", async () => {
    let seen = "";
    const fetchFn = (async (input: string | URL | Request) => {
      seen = String(input);
      return new Response("[]");
    }) as FetchFn;
    const client = new PublicClient({ fetchFn });
    await client.ohlc("BTCIDR", "60", 1, 2);
    expect(seen).toContain("/tradingview/history_v2");
    expect(seen).toContain("symbol=BTCIDR");
  });
});
