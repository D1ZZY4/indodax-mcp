import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import Decimal from "decimal.js";
import {
  TransitionError,
  afterAmbiguousCancel,
  afterNetworkFailure,
  compareBalance,
  compareOrderIds,
  isLegalTransition,
  transition,
} from "@d1zzy4-jethools/indodax-orders";

describe("order machine", () => {
  it("walks the happy path", () => {
    let state = transition("NEW", "SUBMITTING");
    state = transition(state, "ACCEPTED");
    state = transition(state, "FILLED");
    expect(state).toBe("FILLED");
  });

  it("rejects illegal jumps", () => {
    expect(() => transition("NEW", "FILLED")).toThrow(TransitionError);
    expect(isLegalTransition("NEW", "FILLED")).toBe(false);
  });

  it("maps network failure during submit to UNKNOWN", () => {
    expect(afterNetworkFailure("SUBMITTING")).toBe("UNKNOWN");
    expect(afterNetworkFailure("ACCEPTED")).toBe("ACCEPTED");
    expect(afterAmbiguousCancel()).toBe("CANCEL_UNKNOWN");
  });

  it("holds transition invariants", () => {
    const states = ["NEW", "SUBMITTING", "ACCEPTED", "UNKNOWN", "FILLED"] as const;
    fc.assert(
      fc.property(fc.constantFrom(...states), fc.constantFrom(...states), (from, to) => {
        const legal = isLegalTransition(from, to);
        if (legal) {
          expect(transition(from, to)).toBe(to);
        } else {
          expect(() => transition(from, to)).toThrow(TransitionError);
        }
      }),
    );
  });
});

describe("reconcile compare", () => {
  it("matches identical sets", () => {
    expect(compareOrderIds(["a"], ["a"]).state).toBe("MATCH");
  });

  it("flags missing exchange orders", () => {
    const outcome = compareOrderIds(["a"], []);
    expect(outcome.state).toBe("MISMATCH");
    expect(outcome.mismatchedOrders).toEqual(["a"]);
  });

  it("flags exchange-only orders", () => {
    const outcome = compareOrderIds(["a"], ["a", "b"]);
    expect(outcome.state).toBe("MISMATCH");
    expect(outcome.exchangeOnlyIds).toEqual(["b"]);
  });

  it("compares balances within tolerance", () => {
    expect(compareBalance(new Decimal(100), new Decimal(100.005), new Decimal(0.01))).toBe("MATCH");
    expect(compareBalance(new Decimal(100), new Decimal(102), new Decimal(0.01))).toBe("MISMATCH");
  });
});
