import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

/**
 * Guessing a ticker is what produced a ReferenceError in a real harness run.
 * This tool exists so an unverified name is resolved against the live pair
 * list, or reported as unknown, before anything else is called.
 *
 * The fixtures carry the real field orientation from the exchange pair list,
 * where `base_currency` holds the traded asset and `traded_currency` holds the
 * base. Reading those the usual way produced a reversed `idr_cng` pair, so a
 * dedicated test pins the orientation against that exact shape.
 */

const PAIRS = [
  {
    id: "btcidr",
    symbol: "BTCIDR",
    ticker_id: "btc_idr",
    base_currency: "idr",
    traded_currency: "btc",
  },
  {
    id: "ethidr",
    symbol: "ETHIDR",
    ticker_id: "eth_idr",
    base_currency: "idr",
    traded_currency: "eth",
  },
  {
    id: "btcusdt",
    symbol: "BTCUSDT",
    ticker_id: "btc_usdt",
    base_currency: "usdt",
    traded_currency: "btc",
  },
  {
    id: "honeyidr",
    symbol: "HONEYIDR",
    ticker_id: "honey_idr",
    base_currency: "idr",
    traded_currency: "honey",
    quantity_increment: "0.00000001",
    price_precision: "0",
    trade_min_traded_currency: "50000",
  },
  {
    id: "xidr",
    symbol: "XIDR",
    ticker_id: "x_idr",
    base_currency: "idr",
    traded_currency: "x",
    is_market_suspended: 1,
  },
];

type Envelope = {
  status: string;
  data: Record<string, unknown>;
  code?: string;
  message?: string;
};

function withPairs(pairs: unknown) {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  built.app.publicClient = { pairs: async () => pairs } as unknown as PublicClient;
  clearCache();
  return built;
}

async function search(
  harness: Awaited<ReturnType<typeof withInMemoryServer>>,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; envelope: Envelope }> {
  const result = (await harness.client.callTool({
    name: "indodax_search_symbols",
    arguments: args,
  })) as { content: { type: string; text: string }[]; isError?: boolean };
  return {
    isError: result.isError === true,
    envelope: JSON.parse(result.content[0]?.text ?? "{}") as Envelope,
  };
}

describe("symbol search", () => {
  it("never reverses the pair when the currency fields look inverted", async () => {
    // `base_currency` is "idr" and `traded_currency` is "btc" in the real
    // payload, so trusting the field names yields `idr_btc` and every later
    // call silently trades the wrong market.
    const { server } = withPairs(PAIRS);
    const harness = await withInMemoryServer(server);
    try {
      const { envelope } = await search(harness, { query: "btc_idr" });
      const pairs = envelope.data.pairs as { pair: string; base: string; quote: string }[];
      expect(pairs[0]?.pair).toBe("btc_idr");
      expect(pairs[0]?.base).toBe("btc");
      expect(pairs[0]?.quote).toBe("idr");
      expect(envelope.data.pairs).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ pair: "idr_btc" })]),
      );
    } finally {
      await harness.close();
    }
  });

  it("resolves a compact ticker to its canonical pair", async () => {
    const { server } = withPairs(PAIRS);
    const harness = await withInMemoryServer(server);
    try {
      const { isError, envelope } = await search(harness, { query: "BTCIDR" });
      expect(isError).toBe(false);
      expect(envelope.data.matched).toBeGreaterThan(0);
      const pairs = envelope.data.pairs as { pair: string }[];
      expect(pairs[0]?.pair).toBe("btc_idr");
      expect(String(envelope.data.note)).toContain("use pair from this response");
    } finally {
      await harness.close();
    }
  });

  it("resolves a base asset across quotes and can narrow by quote", async () => {
    const { server } = withPairs(PAIRS);
    const harness = await withInMemoryServer(server);
    try {
      const all = await search(harness, { query: "btc" });
      expect((all.envelope.data.pairs as { pair: string }[]).map((p) => p.pair)).toEqual([
        "btc_idr",
        "btc_usdt",
      ]);
      const onlyUsdt = await search(harness, { query: "btc", quote: "USDT" });
      expect((onlyUsdt.envelope.data.pairs as { pair: string }[]).map((p) => p.pair)).toEqual([
        "btc_usdt",
      ]);
    } finally {
      await harness.close();
    }
  });

  it("reports an unknown ticker instead of failing with a reference error", async () => {
    const { server } = withPairs(PAIRS);
    const harness = await withInMemoryServer(server);
    try {
      const { isError, envelope } = await search(harness, { query: "tpHype" });
      expect(isError).toBe(false);
      expect(envelope.data.matched).toBe(0);
      expect(envelope.data.pairs).toEqual([]);
      expect(String(envelope.data.note)).toContain("instead of guessing a ticker");
    } finally {
      await harness.close();
    }
  });

  it("separates a suspended market from a missing symbol", async () => {
    const { server } = withPairs(PAIRS);
    const harness = await withInMemoryServer(server);
    try {
      const { envelope } = await search(harness, { query: "x_idr" });
      expect(envelope.data.matched).toBe(1);
      expect(envelope.data.tradable).toBe(0);
      expect(envelope.data.suspended).toEqual(["x_idr"]);
    } finally {
      await harness.close();
    }
  });

  it("surfaces the precision and minimum needed to size an order", async () => {
    const { server } = withPairs(PAIRS);
    const harness = await withInMemoryServer(server);
    try {
      const { envelope } = await search(harness, { query: "honey" });
      const row = (envelope.data.pairs as Record<string, unknown>[])[0];
      expect(row?.quantityIncrement).toBe("0.00000001");
      expect(row?.tradeMinQuote).toBe("50000");
    } finally {
      await harness.close();
    }
  });

  it("explains an unreachable pair list rather than returning nothing", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.publicClient = {
      pairs: async () => {
        throw new Error("market api down");
      },
    } as unknown as PublicClient;
    clearCache();
    const harness = await withInMemoryServer(built.server);
    try {
      const { isError, envelope } = await search(harness, { query: "btc" });
      expect(isError).toBe(true);
      expect(envelope.code).toBe("ValidationError");
      expect(envelope.message).toContain("rather than guessing a ticker");
    } finally {
      await harness.close();
    }
  });

  it("honours a limit", async () => {
    const { server } = withPairs(PAIRS);
    const harness = await withInMemoryServer(server);
    try {
      const { envelope } = await search(harness, { query: "idr", limit: 2 });
      expect((envelope.data.pairs as unknown[]).length).toBe(2);
      expect(envelope.data.returned).toBe(2);
    } finally {
      await harness.close();
    }
  });
});
