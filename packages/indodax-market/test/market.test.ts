import { describe, expect, it } from "vitest";
import { PublicClient, type FetchFn } from "@indodax-mcp/indodax-client";
import { cacheSize, clearCache, getTicker, normalizePair } from "../src/index.js";

const TICKER = {
  ticker: { high: "110", low: "90", last: "100", buy: "99", sell: "101" },
};

function stubFetch(): FetchFn {
  return (async () => new Response(JSON.stringify(TICKER))) as FetchFn;
}

describe("indodax-market", () => {
  it("normalizes flexible spellings", () => {
    expect(normalizePair("BTCIDR")).toEqual({ base: "btc", quote: "idr" });
    expect(() => normalizePair("!!!")).toThrow();
  });

  it("caches tickers within staleness window", async () => {
    clearCache();
    const client = new PublicClient({ fetchFn: stubFetch() });
    await getTicker(client, "btc_idr");
    await getTicker(client, "BTCIDR");
    expect(cacheSize()).toBe(1);
  });
});
