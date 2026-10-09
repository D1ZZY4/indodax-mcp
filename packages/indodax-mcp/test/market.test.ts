import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

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

describe("market robustness", () => {
  it("flags suspended markets as untradable on pairs", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.publicClient = {
      pairs: async () => [
        { ticker_id: "btc_idr", id: "btcidr", symbol: "BTCIDR", is_market_suspended: 0 },
        { ticker_id: "glidr_idr", id: "glidridr", symbol: "GLIDRIDR", is_market_suspended: 1 },
      ],
    } as unknown as PublicClient;
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_pairs",
        arguments: {},
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const rows = JSON.parse(result.content[0]?.text ?? "{}").data as {
        tradable: boolean;
        ticker_id: string;
      }[];
      expect(rows.find((row) => row.ticker_id === "btc_idr")?.tradable).toBe(true);
      expect(rows.find((row) => row.ticker_id === "glidr_idr")?.tradable).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("names an unreadable orderbook as unavailable instead of a shape error", async () => {
    const { ValidationError } = await import("@indodax-mcp/errors");
    const built = buildIndodaxServer(loadEnv({}));
    built.app.publicClient = {
      depth: async () => {
        throw ValidationError("unexpected shape from /api/depth/glidridr");
      },
    } as unknown as PublicClient;
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_orderbook",
        arguments: { pair: "glidr_idr" },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      const body = JSON.parse(result.content[0]?.text ?? "{}") as {
        message: string;
        safeMetadata?: { reason?: string };
      };
      expect(body.message).toContain("PAIR_UNAVAILABLE");
      expect(body.safeMetadata?.reason).toBe("PAIR_UNAVAILABLE");
    } finally {
      await harness.close();
    }
  });

  it("summarizes taker flow with a dominance warning", async () => {
    const trades = [
      ...Array.from({ length: 93 }, (_, index) => ({ type: "sell", tid: index })),
      ...Array.from({ length: 7 }, (_, index) => ({ type: "buy", tid: 100 + index })),
    ];
    const built = buildIndodaxServer(loadEnv({}));
    built.app.publicClient = { trades: async () => trades } as unknown as PublicClient;
    const harness = await withInMemoryServer(built.server);
    try {
      const data = (await dataOf(
        harness.client.callTool({
          name: "indodax_trades",
          arguments: { pair: "nova_idr", limit: 100 },
        }),
      )) as {
        flow: { buyCount: number; sellCount: number; buyRatio: number };
        flowWarning: string;
      };
      expect(data.flow.buyCount).toBe(7);
      expect(data.flow.sellCount).toBe(93);
      expect(data.flow.buyRatio).toBe(0.07);
      expect(data.flowWarning).toContain("seller-dominated");
      // Rows carry both spellings: `type` is the exchange spelling and `side`
      // is the canonical alias, so a caller reading either one gets a side.
      const rows = (data as unknown as { trades: { type: string; side: string }[] }).trades;
      expect(rows).toHaveLength(100);
      expect(new Set(rows.map((row) => row.side))).toEqual(new Set(["buy", "sell"]));
      expect(rows.every((row) => row.side === row.type)).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("carries range, position, and spread on a single ticker", async () => {
    clearCache();
    const built = buildIndodaxServer(loadEnv({}));
    built.app.publicClient = {
      ticker: async () => ({
        high: "120",
        low: "100",
        last: "110",
        buy: "109",
        sell: "111",
      }),
    } as unknown as PublicClient;
    const harness = await withInMemoryServer(built.server);
    try {
      const data = (await dataOf(
        harness.client.callTool({ name: "indodax_ticker", arguments: { pair: "x_idr" } }),
      )) as { rangePct: number; pos: number; spreadPct: number };
      expect(data.rangePct).toBe(20);
      expect(data.pos).toBe(0.5);
      expect(data.spreadPct).toBe(1.83);
    } finally {
      await harness.close();
      clearCache();
    }
  });
});

describe("named-market screening", () => {
  it("screens listed pairs without fetching the universe", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_tickers_all",
        arguments: { pairs: ["BTCIDR", "nope-coin"] },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const text = result.content[0]?.text ?? "{}";
      const data = (JSON.parse(text) as { data: Record<string, unknown> }).data as {
        pairs: string[];
        unknown: string[];
        total: number;
      };
      expect(data.pairs).toEqual(["btc_idr"]);
      expect(data.unknown).toEqual(["nope-coin"]);
      expect(data.total).toBe(3);
    } finally {
      await harness.close();
    }
  });
});
