import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import Decimal from "decimal.js";
import {
  asCompact,
  asPair,
  decimalOrNull,
  isValidClientOrderId,
  parseSymbolFlexible,
  validateOrderInput,
} from "../src/index.js";

describe("core money", () => {
  it("parses exchange decimal strings without float loss", () => {
    expect(decimalOrNull("0.00000001")?.toString()).toBe("1e-8");
    expect(decimalOrNull("abc")).toBeNull();
    expect(new Decimal("0.1").plus("0.2").toString()).toBe("0.3");
  });

  it("rejects non-finite boundary values", () => {
    expect(decimalOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(decimalOrNull("Infinity")).toBeNull();
    expect(decimalOrNull("abc")).toBeNull();
  });

  it("holds decimal invariants under arbitrary inputs", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (value) => {
        const parsed = decimalOrNull(value.toString());
        expect(parsed === null || parsed.isFinite()).toBe(true);
      }),
    );
  });
});

describe("core symbols", () => {
  it("parses flexible spellings", () => {
    expect(parseSymbolFlexible("BTC/IDR")).toEqual({ base: "btc", quote: "idr" });
    expect(parseSymbolFlexible("BTCIDR")).toEqual({ base: "btc", quote: "idr" });
    expect(parseSymbolFlexible("btc_idr")).toEqual({ base: "btc", quote: "idr" });
    expect(asPair({ base: "btc", quote: "idr" })).toBe("btc_idr");
    expect(asCompact({ base: "btc", quote: "idr" })).toBe("btcidr");
  });

  it("accepts caller-supplied quote assets", () => {
    expect(parseSymbolFlexible("XBTSOL", ["sol"])).toEqual({ base: "xbt", quote: "sol" });
    expect(parseSymbolFlexible("XBTSOL")).toBeNull();
  });
});

describe("core order validation", () => {
  it("enforces client id charset and length", () => {
    expect(isValidClientOrderId("btcidr-buy-1")).toBe(true);
    expect(isValidClientOrderId("bad id!")).toBe(false);
    expect(isValidClientOrderId("x".repeat(37))).toBe(false);
  });

  it("requires quoteOrderQty for BUY MARKET and forbids quantity mix", () => {
    const base = {
      internalOrderId: "i1",
      clientOrderId: "c1",
      symbol: { base: "btc", quote: "idr" },
      side: "BUY" as const,
      orderType: "MARKET" as const,
      price: null,
      quantity: new Decimal(1),
      quoteOrderQuantity: new Decimal(10000),
    };
    expect(validateOrderInput(base).ok).toBe(false);
    expect(validateOrderInput({ ...base, quantity: null }).ok).toBe(true);
  });
});
