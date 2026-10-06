import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { roundOrder } from "@indodax-mcp/indodax-mcp/order-rounding";
import Decimal from "decimal.js";

/**
 * Precision rejection is the most common placement failure, and a loop that
 * had to floor quantities itself got it wrong. Rounding happens before
 * submission, and a rule that cannot be satisfied fails with real numbers.
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
    trade_min_base_currency: "1",
    trade_min_traded_currency: "5000",
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
      expect(r.isError).not.toBe(true);
      const d = JSON.parse(r.content[0]!.text).data as Record<string, unknown>;
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
      const b = JSON.parse(r.content[0]!.text) as { message: string };
      expect(b.message).toContain("no tradable market for nope_idr");
    } finally {
      await harness.close();
    }
  });
});
