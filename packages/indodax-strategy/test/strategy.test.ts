import { describe, expect, it } from "vitest";
import {
  BUILTIN_STRATEGIES,
  evaluateMovingAverage,
  movingAverage,
  validateSignalInput,
} from "../src/index.js";

const SYMBOL = { base: "btc", quote: "idr" };

describe("strategy", () => {
  it("lists builtin strategies", () => {
    expect(BUILTIN_STRATEGIES.map((strategy) => strategy.id)).toEqual([
      "ma-cross",
      "momentum-threshold",
    ]);
  });

  it("computes moving averages", () => {
    expect(movingAverage([1, 2, 3], 3)).toBe(2);
    expect(movingAverage([1], 3)).toBeNull();
  });

  it("emits direction without placing orders", () => {
    const signal = evaluateMovingAverage({ symbol: SYMBOL, closes: [100, 110, 120], window: 3 });
    expect(signal?.side).toBe("BUY");
    expect(validateSignalInput({ symbol: SYMBOL, closes: [100], window: 5 })).not.toHaveLength(0);
  });
});
