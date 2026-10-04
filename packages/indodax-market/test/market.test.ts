import { describe, expect, it } from "vitest";
import { PublicClient, type FetchFn } from "@indodax-mcp/indodax-client";
import {
  cacheSize,
  checkQuantityIncrement,
  clearCache,
  getTicker,
  isMarketSuspended,
  normalizePair,
  toCompactPair,
} from "../src/index.js";

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

  it("compacts pairs for depth, trades, and candles endpoints", () => {
    expect(toCompactPair("btc_idr")).toBe("btcidr");
    expect(toCompactPair("BTC/IDR")).toBe("btcidr");
    expect(toCompactPair("BTCIDR")).toBe("btcidr");
    expect(() => toCompactPair("!!!")).toThrow();
  });

  it("reads market suspension from the pair list", async () => {
    clearCache();
    const pairsFetch = (async () =>
      new Response(
        JSON.stringify([
          {
            id: "btcidr",
            symbol: "BTCIDR",
            base_currency: "idr",
            traded_currency: "btc",
            ticker_id: "btc_idr",
            is_market_suspended: 0,
          },
          {
            id: "ethidr",
            symbol: "ETHIDR",
            base_currency: "idr",
            traded_currency: "eth",
            ticker_id: "eth_idr",
            is_market_suspended: 1,
          },
        ]),
      )) as FetchFn;
    const client = new PublicClient({ fetchFn: pairsFetch });
    expect(await isMarketSuspended(client, "btc_idr")).toBe(false);
    expect(await isMarketSuspended(client, "ETHIDR")).toBe(true);
    expect(await isMarketSuspended(client, "xrp_idr")).toBeNull();
  });

  it("treats an unreachable pair list as unknown, not halted", async () => {
    clearCache();
    const failing = (async () => new Response("down", { status: 500 })) as FetchFn;
    const client = new PublicClient({ fetchFn: failing });
    expect(await isMarketSuspended(client, "btc_idr")).toBeNull();
  });

  it("rejects quantities below the pair increment with a suggestion", async () => {
    const pairsFetch = (async () =>
      new Response(
        JSON.stringify([
          {
            id: "mubarakidr",
            symbol: "MUBARAKIDR",
            base_currency: "idr",
            traded_currency: "mubarak",
            ticker_id: "mubarak_idr",
            quantity_increment: "1",
          },
        ]),
      )) as FetchFn;
    const client = new PublicClient({ fetchFn: pairsFetch });
    await expect(checkQuantityIncrement(client, "MUBARAKIDR", 13.4)).rejects.toThrow(
      /increment 1.*such as 13/,
    );
    await expect(checkQuantityIncrement(client, "mubarak_idr", 13)).resolves.toBeUndefined();
  });

  it("skips the increment check when the pair list is unreachable", async () => {
    clearCache();
    const failing = (async () => new Response("down", { status: 500 })) as FetchFn;
    const client = new PublicClient({ fetchFn: failing });
    await expect(checkQuantityIncrement(client, "btc_idr", 13.4)).resolves.toBeUndefined();
  });
});
