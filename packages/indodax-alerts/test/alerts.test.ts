import { describe, expect, it } from "vitest";
import { AlertStore, shouldTrigger } from "../src/index.js";

describe("alerts", () => {
  it("evaluates threshold conditions", () => {
    expect(shouldTrigger({ type: "above", price: "100" }, 100)).toBe(true);
    expect(shouldTrigger({ type: "below", price: "100" }, 101)).toBe(false);
  });

  it("compares precise exchange strings without float loss", () => {
    expect(shouldTrigger({ type: "above", price: "100000.12345678" }, "100000.12345678")).toBe(
      true,
    );
    expect(shouldTrigger({ type: "above", price: "100000.12345678" }, "100000.12345677")).toBe(
      false,
    );
    const store = new AlertStore();
    store.add({ pair: "btc_idr", condition: { type: "above", price: "100000.12345678" } });
    expect(store.check("btc_idr", "100000.12345678")).toHaveLength(1);
  });

  it("adds, triggers, and cancels", () => {
    const store = new AlertStore();
    const alert = store.add({ pair: "btc_idr", condition: { type: "above", price: "10" } });
    expect(store.list()).toHaveLength(1);
    expect(store.check("btc_idr", 11)).toHaveLength(1);
    expect(store.list()).toHaveLength(0);
    expect(store.cancel(alert.id)).toBe(false);
  });

  it("restores snapshots and skips corrupt rows", () => {
    const store = new AlertStore();
    store.restore([
      {
        id: "alert-4",
        pair: "btc_idr",
        condition: { type: "above", price: "10" },
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      { nope: true },
      { id: "alert-x", pair: "btc_idr" },
    ]);
    expect(store.list()).toHaveLength(1);
    expect(store.add({ pair: "eth_idr", condition: { type: "below", price: "5" } }).id).toBe(
      "alert-5",
    );
  });
});
