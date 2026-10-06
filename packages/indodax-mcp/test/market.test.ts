import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

const tickers = {
  tickers: {
    btc_idr: { high: "2", low: "1", last: "2", buy: "2", sell: "2" },
    eth_usdt: { high: "2", low: "1", last: "2", buy: "2", sell: "2" },
    btc_usdt: { high: "2", low: "1", last: "2", buy: "2", sell: "2" },
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
  it("returns only price and volume unless fields is asked for", async () => {
    // The exchange sends the full body for roughly 475 pairs, which is enough
    // to flood a harness context on one unfiltered scan.
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const data = (await dataOf(
        harness.client.callTool({ name: "indodax_tickers_all", arguments: {} }),
      )) as {
        tickers: Record<string, Record<string, unknown>>;
        fields: string[];
      };
      expect(data.fields).toEqual(["last", "vol_idr"]);
      const row = data.tickers.btc_idr;
      expect(row?.last).toBe("2");
      expect(row?.high).toBeUndefined();
      expect(row?.buy).toBeUndefined();
      expect(row?.sell).toBeUndefined();
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
      expect(row?.buy).toBe("2");
      expect(row?.sell).toBe("2");
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
