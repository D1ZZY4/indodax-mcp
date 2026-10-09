/**
 * Regression for the candles contract as reported from a production loop.
 *
 * Two problems existed: the timeframe was an unconstrained string, so every
 * unsupported value cost a live round trip and a 400, and the response was a
 * bare array, so a caller could not attribute the rows to a pair, a timeframe
 * or a window.
 */
import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

const BARS = [
  { Time: 1791399960, Open: 1, High: 2, Low: 1, Close: 2, Volume: "10" },
  { Time: 1791399600, Open: 2, High: 3, Low: 2, Close: 3, Volume: "12" },
];

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

function stubbed() {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  const seen: { symbol: string; timeframe: string; from: number; to: number }[] = [];
  built.app.publicClient = {
    ohlc: async (symbol: string, timeframe: string, from: number, to: number) => {
      seen.push({ symbol, timeframe, from, to });
      return BARS;
    },
  } as unknown as PublicClient;
  return { built, seen };
}

async function call(harness: Harness, args: Record<string, unknown>) {
  const result = (await harness.client.callTool({
    name: "indodax_candles",
    arguments: args,
  })) as { content: { text: string }[]; isError?: boolean };
  return {
    isError: result.isError === true,
    text: result.content[0]?.text ?? "{}",
  };
}

describe("candles timeframe contract", () => {
  it("accepts every timeframe the exchange supports", async () => {
    const supported = ["1", "3", "5", "15", "30", "60", "120", "240", "1D", "3D", "1W", "1M"];
    for (const timeframe of supported) {
      const { built, seen } = stubbed();
      const harness = await withInMemoryServer(built.server);
      try {
        const out = await call(harness, { symbol: "btc_idr", timeframe });
        expect(out.isError, `timeframe ${timeframe} should be accepted`).toBe(false);
        expect(seen.at(0)?.timeframe).toBe(timeframe);
      } finally {
        await harness.close();
      }
    }
  });

  it("rejects the aliases the exchange answers 400 for, without a round trip", async () => {
    // Verified against /tradingview/history_v2 on 2026-10-09: 1H, 4H, D, 2D,
    // 7D, 180, 360, 720 and 1440 all answer "invalid TimeFrame". The schema
    // now refuses them locally instead of spending a call per value.
    const rejected = ["1H", "4H", "D", "2D", "7D", "2", "180", "360", "720", "1440"];
    for (const timeframe of rejected) {
      const { built, seen } = stubbed();
      const harness = await withInMemoryServer(built.server);
      try {
        const out = await call(harness, { symbol: "btc_idr", timeframe });
        expect(out.isError, `timeframe ${timeframe} should be refused locally`).toBe(true);
        expect(seen).toHaveLength(0);
      } finally {
        await harness.close();
      }
    }
  });

  it("defaults to the 60 minute timeframe", async () => {
    const { built, seen } = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const out = await call(harness, { symbol: "btc_idr" });
      expect(out.isError).toBe(false);
      expect(seen.at(0)?.timeframe).toBe("60");
    } finally {
      await harness.close();
    }
  });
});

describe("candles response shape", () => {
  it("attributes rows to the pair, timeframe and window", async () => {
    const { built } = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const out = await call(harness, { symbol: "BTCIDR", timeframe: "240", from: 10, to: 20 });
      const body = JSON.parse(out.text) as {
        data: {
          pair: string;
          timeframe: string;
          from: number;
          to: number;
          count: number;
          bars: { time: number; close: string; closeNum: number }[];
          note: string;
          summary: string;
        };
      };
      expect(body.data.pair).toBe("btc_idr");
      expect(body.data.timeframe).toBe("240");
      expect(body.data.from).toBe(10);
      expect(body.data.to).toBe(20);
      expect(body.data.count).toBe(2);
      expect(body.data.bars).toHaveLength(2);
      expect(body.data.summary).toContain("btc_idr");
      // Money stays a decimal string; the numeric mirror is explicit.
      expect(body.data.bars[0]?.close).toBe("2");
      expect(body.data.bars[0]?.closeNum).toBe(2);
      expect(body.data.bars[0]?.time).toBe(1791399960);
    } finally {
      await harness.close();
    }
  });

  it("keeps the exchange symbol spelling on the wire", async () => {
    const { built, seen } = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      await call(harness, { symbol: "btc_idr" });
      expect(seen.at(0)?.symbol).toBe("BTCIDR");
    } finally {
      await harness.close();
    }
  });
});
