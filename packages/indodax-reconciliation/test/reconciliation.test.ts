import { describe, expect, it } from "vitest";
import { reconcileAll, reconcileFills } from "@d1zzy4-jethools/indodax-reconciliation";

describe("reconciliation", () => {
  it("converges matching ledgers", () => {
    const report = reconcileAll({
      localOrders: [],
      exchangeOrders: [],
      localFills: [{ exchangeOrderId: "1", quantity: "2" }],
      exchangeFills: [
        { exchangeOrderId: "1", quantity: "1" },
        { exchangeOrderId: "1", quantity: "1" },
      ],
      balances: [{ asset: "idr", local: "100", exchange: "100.001", tolerance: "0.01" }],
    });
    expect(report.overall).toBe("MATCH");
  });

  it("flags fill divergence", () => {
    const result = reconcileFills(
      [{ exchangeOrderId: "1", quantity: "2" }],
      [{ exchangeOrderId: "1", quantity: "1" }],
    );
    expect(result.state).toBe("MISMATCH");
    expect(result.mismatched).toEqual(["1"]);
  });

  it("flags exchange-only fills", () => {
    const result = reconcileFills(
      [{ exchangeOrderId: "1", quantity: "2" }],
      [
        { exchangeOrderId: "1", quantity: "2" },
        { exchangeOrderId: "2", quantity: "3" },
      ],
    );
    expect(result.state).toBe("MISMATCH");
    expect(result.exchangeOnly).toEqual(["2"]);
  });
});
