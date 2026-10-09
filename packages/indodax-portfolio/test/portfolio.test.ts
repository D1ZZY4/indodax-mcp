import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { drawdownPct, equityIdr, pnl } from "@d1zzy4-jethools/indodax-portfolio";

describe("portfolio", () => {
  it("values holdings in IDR", () => {
    const { equity, positions } = equityIdr(
      [
        { asset: "idr", available: new Decimal(100), locked: new Decimal(0) },
        { asset: "btc", available: new Decimal(1), locked: new Decimal(0) },
      ],
      new Map([["btc_idr", new Decimal(1000)]]),
    );
    expect(equity.toString()).toBe("1100");
    expect(positions).toBe(2);
  });

  it("computes pnl and drawdown", () => {
    expect(pnl(new Decimal(110), new Decimal(100)).toString()).toBe("10");
    expect(drawdownPct(new Decimal(90), new Decimal(100)).toString()).toBe("10");
  });
});
