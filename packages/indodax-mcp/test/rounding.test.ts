import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";
import { roundOrder, roundingContextFor } from "@indodax-mcp/mcp-app/order-rounding";
import Decimal from "decimal.js";

/**
 * Precision rejection is the most common placement failure, and a loop that
 * had to floor quantities itself got it wrong. Rounding happens before
 * submission, and a rule that cannot be satisfied fails with real numbers.
 */
/**
 * The exchange names these two fields counter-intuitively:
 * `trade_min_base_currency` is the notional floor in fiat, and
 * `trade_min_traded_currency` is the quantity floor of the traded asset.
 * Swapping them would reject every sane order, so the fixture mirrors the real
 * orientation: 5000 IDR minimum notional, 1 RAD minimum quantity.
 */
const PAIRS = [
  {
    id: "radidr",
    symbol: "RADIDR",
    ticker_id: "rad_idr",
    base_currency: "idr",
    traded_currency: "rad",
    quantity_increment: "0.1",
    price_precision: "2",
    trade_min_base_currency: "5000",
    trade_min_traded_currency: "1",
  },
];

function stubbed(pairs: unknown = PAIRS) {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  built.app.publicClient = {
    pairs: async () => pairs,
    ticker: async () => ({ high: "1", low: "1", last: "1", buy: "1", sell: "1" }),
  } as unknown as PublicClient;
  clearCache();
  return built;
}

/** Read the first text block without a non-null assertion. */
function textOf(result: { content: { text: string }[] }): string {
  const block = result.content.at(0);
  if (block === undefined) throw new Error("expected a text content block");
  return block.text;
}

describe("order rounding", () => {
  it("rounds quantity down to the increment and price to the precision", () => {
    const r = roundOrder("5.37", "1234.567", {
      pair: "rad_idr",
      quantityIncrement: new Decimal("0.1"),
      priceIncrement: null,
      pricePrecision: 2,
      quantityMin: null,
      tradeMinQuote: null,
    });
    expect(r.quantity).toBe("5.3");
    expect(r.price).toBe("1234.56");
    expect(r.adjusted).toBe(true);
  });

  it("refuses when the increment leaves nothing tradable", () => {
    expect(() =>
      roundOrder("0.05", null, {
        pair: "rad_idr",
        quantityIncrement: new Decimal("0.1"),
        priceIncrement: null,
        pricePrecision: null,
        quantityMin: null,
        tradeMinQuote: null,
      }),
    ).toThrow(/smaller than one rad_idr increment/);
  });

  it("refuses below the pair minimum with the real numbers", () => {
    expect(() =>
      roundOrder("0.5", "1000", {
        pair: "rad_idr",
        quantityIncrement: new Decimal("0.1"),
        priceIncrement: null,
        pricePrecision: 2,
        quantityMin: new Decimal("1"),
        tradeMinQuote: new Decimal("5000"),
      }),
    ).toThrow(/below the rad_idr minimum/);
  });

  it("refuses a notional under the pair minimum", () => {
    expect(() =>
      roundOrder("2", "100", {
        pair: "rad_idr",
        quantityIncrement: new Decimal("0.1"),
        priceIncrement: null,
        pricePrecision: 2,
        quantityMin: null,
        tradeMinQuote: new Decimal("5000"),
      }),
    ).toThrow(/notional 200 is below the rad_idr minimum of 5000/);
  });

  it("reports through the tool without placing anything", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const r = (await harness.client.callTool({
        name: "indodax_round_order",
        arguments: { pair: "rad_idr", side: "BUY", quantity: 5.37, price: 1234.567 },
      })) as { content: { text: string }[]; isError?: boolean };
      // The SDK omits the flag on success, so assert on the body instead.
      const d = JSON.parse(textOf(r)).data as Record<string, unknown>;
      expect(d.quantity).toBe("5.3");
      expect(d.price).toBe("1234.56");
      expect(d.adjusted).toBe(true);
      expect((d.rules as Record<string, unknown>).quantityIncrement).toBe("0.1");
    } finally {
      await harness.close();
    }
  });

  it("names the missing market instead of guessing a rule", async () => {
    const { server } = stubbed([]);
    const harness = await withInMemoryServer(server);
    try {
      const r = (await harness.client.callTool({
        name: "indodax_round_order",
        arguments: { pair: "nope_idr", quantity: 1 },
      })) as { content: { text: string }[]; isError?: boolean };
      const b = JSON.parse(textOf(r)) as { message: string };
      expect(b.message).toContain("no tradable market for nope_idr");
    } finally {
      await harness.close();
    }
  });

  it("resolves id and symbol spellings to the same pair rules", () => {
    // The pair list carries ticker_id, id, and symbol. Matching ticker_id
    // only reported a valid market as unknown when the caller used the
    // compact or uppercase spelling.
    const byTicker = roundingContextFor("rad_idr", PAIRS);
    const byId = roundingContextFor("radidr", PAIRS);
    const bySymbol = roundingContextFor("RADIDR", PAIRS);
    expect(byTicker?.quantityIncrement?.toString()).toBe("0.1");
    expect(byId?.quantityIncrement?.toString()).toBe("0.1");
    expect(bySymbol?.quantityIncrement?.toString()).toBe("0.1");
  });
});

describe("suggest stop", () => {
  it("prices a feasible stop with reward-to-risk", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const r = (await harness.client.callTool({
        name: "indodax_suggest_stop",
        arguments: {
          pair: "rad_idr",
          side: "SELL",
          quantity: 20,
          entryPrice: 1000,
          targetPct: 5,
          takeProfitPrice: 1200,
        },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError).not.toBe(true);
      const d = JSON.parse(textOf(r)).data as Record<string, unknown>;
      expect(d.stopPrice).toBe("950");
      expect(d.stopNotional).toBe("19000");
      expect(d.meetsMinimum).toBe(true);
      expect(d.rr).toBe(4);
    } finally {
      await harness.close();
    }
  });

  it("names the nearest feasible distance when the target cannot clear the floor", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const r = (await harness.client.callTool({
        name: "indodax_suggest_stop",
        arguments: {
          pair: "rad_idr",
          side: "SELL",
          quantity: 10.4,
          entryPrice: 1000,
          targetPct: 5,
        },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError).not.toBe(true);
      const body = JSON.parse(textOf(r)) as {
        data: Record<string, unknown>;
        warnings?: string[];
      };
      expect(body.data.meetsMinimum).toBe(false);
      expect(body.data.maxFeasiblePct).toBe(3.85);
      expect([...(body.warnings ?? [])].join(" ")).toContain("cannot clear");
    } finally {
      await harness.close();
      clearCache();
    }
  });
});
