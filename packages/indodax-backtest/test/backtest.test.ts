import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { runBacktest } from "@d1zzy4-jethools/indodax-backtest";

function closes(...values: number[]): Decimal[] {
  return values.map((value) => new Decimal(value));
}

describe("backtest", () => {
  it("counts threshold crossings deterministically", () => {
    const first = runBacktest(closes(100, 110, 111), {
      feeRate: new Decimal("0.0026"),
      threshold: new Decimal("0.05"),
      notional: new Decimal(1000),
    });
    const second = runBacktest(closes(100, 110, 111), {
      feeRate: new Decimal("0.0026"),
      threshold: new Decimal("0.05"),
      notional: new Decimal(1000),
    });
    expect(first.hypotheticalFills).toBe(1);
    expect(first).toEqual(second);
    expect(first.netPnl.gt(0)).toBe(true);
  });

  it("ignores flat series without future leakage", () => {
    const report = runBacktest(closes(100, 100, 100), {
      feeRate: new Decimal("0.0026"),
      threshold: new Decimal("0.05"),
      notional: new Decimal(1000),
    });
    expect(report.hypotheticalFills).toBe(0);
    expect(report.signalsEvaluated).toBe(2);
  });
});
