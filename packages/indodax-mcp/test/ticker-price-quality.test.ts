/**
 * Regression for the price-quality contract on the ticker surface.
 *
 * Measured against the live orderbook on 2026-10-09: the cached quotes matched
 * the book on every sampled pair, but a cached row up to 13s old reported a
 * spread differing from the live book by as much as 0.54 percentage points.
 * A cost model therefore cannot treat a cached spread as the live spread, and
 * the response has to say so rather than leaving it to be rediscovered.
 *
 * Deterministic here: the exchange is stubbed, so the cache is the only source
 * of a stale row.
 */
import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

interface TickerData {
  last: string;
  bid: string;
  ask: string;
  source: string;
  ageMs: number | null;
  stale: boolean;
  spreadPct: number | null;
  dataQuality: {
    source: string;
    ageMs: number | null;
    cacheTtlMs: number;
    spreadFromLiveBook: boolean;
    note: string;
  };
}

function stubbed(last: string) {
  clearCache();
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  built.app.publicClient = {
    ticker: async () => ({ high: last, low: last, last, buy: last, sell: last }),
    tickerAll: async () => ({
      tickers: {
        btc_idr: { high: last, low: last, last, buy: last, sell: last, vol_idr: "1000000" },
      },
    }),
    pairs: async () => [],
  } as unknown as PublicClient;
  // Cleared again after the stub is installed, so the first call in each test
  // reads live rather than inheriting a row from an earlier test.
  clearCache();
  return { built };
}

async function ticker(harness: Harness, pair: string) {
  const result = (await harness.client.callTool({
    name: "indodax_ticker",
    arguments: { pair },
  })) as {
    content: { text: string }[];
    isError?: boolean;
    warnings?: string[];
  };
  expect(result.isError).not.toBe(true);
  const body = JSON.parse(result.content[0]?.text ?? "{}") as {
    data: TickerData;
    warnings?: string[];
  };
  return { data: body.data, warnings: body.warnings ?? [] };
}

describe("ticker price quality is explicit", () => {
  it("marks a live read as usable for a cost decision", async () => {
    const { built } = stubbed("2000");
    const harness = await withInMemoryServer(built.server);
    try {
      const { data, warnings } = await ticker(harness, "btc_idr");
      expect(data.source).toBe("live");
      expect(data.dataQuality.spreadFromLiveBook).toBe(true);
      expect(data.dataQuality.cacheTtlMs).toBe(30_000);
      expect(warnings).toEqual([]);
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("marks a cached read and warns that the spread may not be live", async () => {
    const { built } = stubbed("2000");
    const harness = await withInMemoryServer(built.server);
    try {
      await ticker(harness, "btc_idr");
      const { data, warnings } = await ticker(harness, "btc_idr");
      expect(data.source).toBe("cache");
      expect(data.dataQuality.spreadFromLiveBook).toBe(false);
      expect(data.dataQuality.note).toContain("cache");
      // A warning rides the envelope so a polling loop cannot miss it.
      expect(warnings.join(" ")).toContain("came from cache");
      expect(warnings.join(" ")).toContain("indodax_orderbook");
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("keeps the age alongside the source so a caller can bound the staleness", async () => {
    const { built } = stubbed("2000");
    const harness = await withInMemoryServer(built.server);
    try {
      const first = await ticker(harness, "btc_idr");
      // A just-fetched row is fresh by construction. Asserting exactly 0 raced
      // the clock: ageMs is derived from two Date.now() calls, so a millisecond
      // boundary between them made this fail intermittently.
      expect(first.data.ageMs).toBeLessThan(50);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const second = await ticker(harness, "btc_idr");
      expect(second.data.source).toBe("cache");
      // A cached row ages from the exchange read, so the age grows rather than
      // resetting on each cache serve.
      expect(second.data.ageMs).toBeGreaterThanOrEqual(1000);
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("does not claim a cached spread is live in the shared screening fields", async () => {
    // tickers_all and indodax_ticker share screenValues, so both can be read by
    // the same screener. Neither may imply a cached row was a live read.
    const { built } = stubbed("2000");
    const harness = await withInMemoryServer(built.server);
    try {
      await ticker(harness, "btc_idr");
      const result = (await harness.client.callTool({
        name: "indodax_tickers_all",
        arguments: { pairs: ["btc_idr"] },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const body = JSON.parse(result.content[0]?.text ?? "{}") as {
        data: { tickers: Record<string, { spreadPct?: number }> };
        note?: string;
      };
      expect(body.data.tickers.btc_idr?.spreadPct).not.toBeUndefined();
    } finally {
      await harness.close();
      clearCache();
    }
  });
});
