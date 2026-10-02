import { describe, expect, it } from "vitest";
import { AlertStore, shouldTrigger } from "../src/index.js";

describe("alerts", () => {
  it("evaluates threshold conditions", () => {
    expect(shouldTrigger({ type: "above", price: "100" }, 100)).toBe(true);
    expect(shouldTrigger({ type: "below", price: "100" }, 101)).toBe(false);
  });

  it("adds, triggers, and cancels", () => {
    const store = new AlertStore();
    const alert = store.add({ pair: "btc_idr", condition: { type: "above", price: "10" } });
    expect(store.list()).toHaveLength(1);
    expect(store.check("btc_idr", 11)).toHaveLength(1);
    expect(store.list()).toHaveLength(0);
    expect(store.cancel(alert.id)).toBe(false);
  });
});
