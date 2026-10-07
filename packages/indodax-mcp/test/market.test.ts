import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

const tickers = {
  tickers: {
    btc_idr: {
      high: "120",
      low: "100",
      last: "110",
      buy: "109",
      sell: "111",
      vol_idr: "600000000",
    },
    eth_usdt: { high: "2", low: "1", last: "2", buy: "2", sell: "2", vol_idr: "10" },
    btc_usdt: { high: "2", low: "1", last: "2", buy: "2", sell: "2", vol_idr: "10" },
  },
};

function stubbed() {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.publicClient = {
    tickerAll: async () => tickers,
    trades: async () => [1, 2, 3, 4, 5],
  } as unknown as PublicClient;
  return built;
}

async function dataOf(call: Promise<unknown>) {
  const result = (await call) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  const text = result.content[0]?.text ?? "{}";
  return (JSON.parse(text) as { data: Record<string, unknown> }).data;
}

describe("market filters", () => {
  it("returns screening-ready defaults with range, position, and spread", async () => {
    // Screening needs high/low for range, buy/sell for spread, and volume in
    // one call. Defaults carry all six plus derived rangePct, pos, and
    // spreadPct so a harness sorts candidates without re-parsing decimals.
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const data = (await dataOf(
        harness.client.callTool({ name: "indodax_tickers_all", arguments: {} }),
      )) as {
        tickers: Record<string, Record<string, unknown>>;
        fields: string[];
      };
      expect(data.fields).toEqual(["last", "high", "low", "buy", "sell", "vol_idr"]);
      const row = data.tickers.btc_idr;
      expect(row?.last).toBe("110");
      expect(row?.high).toBe("120");
      expect(row?.vol_idr).toBe("600000000");
      expect(row?.rangePct).toBe(20);
      expect(row?.pos).toBe(0.5);
      expect(row?.spreadPct).toBe(1.83);
    } finally {
      await harness.close();
    }
  });

  it("honours an explicit fields selection", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const data = (await dataOf(
        harness.client.callTool({
          name: "indodax_tickers_all",
          arguments: { fields: ["last", "buy", "sell"] },
        }),
      )) as { tickers: Record<string, Record<string, unknown>>; fields: string[] };
      expect(data.fields).toEqual(["last", "buy", "sell"]);
      const row = data.tickers.btc_idr;
      expect(row?.buy).toBe("109");
      expect(row?.sell).toBe("111");
      expect(row?.high).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it("filters tickers by quote and limits rows", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const filtered = (await dataOf(
        harness.client.callTool({ name: "indodax_tickers_all", arguments: { quote: "usdt" } }),
      )) as { tickers: Record<string, unknown>; count: number; summary: string };
      expect(Object.keys(filtered.tickers)).toEqual(["eth_usdt", "btc_usdt"]);
      expect(filtered.count).toBe(2);
      const limited = (await dataOf(
        harness.client.callTool({ name: "indodax_tickers_all", arguments: { limit: 1 } }),
      )) as { tickers: Record<string, unknown>; count: number };
      expect(Object.keys(limited.tickers)).toHaveLength(1);
      expect(limited.count).toBe(1);
    } finally {
      await harness.close();
    }
  });

  it("combines volume, range, and spread filters with AND logic", async () => {
    // Regression for the live report where minVolumeIdr plus fields always
    // returned zero rows: volume keys were stripped before filtering, so every
    // row failed the floor.
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const filtered = (await dataOf(
        harness.client.callTool({
          name: "indodax_tickers_all",
          arguments: {
            quote: "IDR",
            minVolumeIdr: 500000000,
            fields: ["last", "high", "low", "buy", "sell", "vol_idr"],
          },
        }),
      )) as {
        tickers: Record<string, Record<string, unknown>>;
        count: number;
        matched: number;
        total: number;
      };
      expect(Object.keys(filtered.tickers)).toEqual(["btc_idr"]);
      expect(filtered.count).toBe(1);
      expect(filtered.matched).toBe(1);
      expect(filtered.total).toBe(3);
      expect(filtered.tickers.btc_idr?.vol_idr).toBe("600000000");
      const ranged = (await dataOf(
        harness.client.callTool({
          name: "indodax_tickers_all",
          arguments: { minRangePct: 50 },
        }),
      )) as { count: number; matched: number };
      expect(ranged.matched).toBe(2);
      expect(ranged.count).toBe(2);
    } finally {
      await harness.close();
    }
  });
  it("limits public trades", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const limited = (await dataOf(
        harness.client.callTool({
          name: "indodax_trades",
          arguments: { pair: "btc_idr", limit: 2 },
        }),
      )) as { trades: unknown[]; count: number; summary: string };
      expect(limited.trades).toHaveLength(2);
      expect(limited.count).toBe(2);
    } finally {
      await harness.close();
    }
  });
});
