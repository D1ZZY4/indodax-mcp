import { decimalOrNull } from "@indodax-mcp/core";
import type { AppServices } from "./composition.js";

export interface PaperConsistency {
  state: "MATCH" | "MISMATCH";
  checkedOrders: number;
  mismatchedOrders: string[];
}

/**
 * Paper-ledger internal consistency.
 *
 * Every open order must hold parseable amounts with remaining inside
 * [0, quantity]. The paper executor maintains that invariant, so a MISMATCH
 * means state was corrupted or restored from a bad snapshot, which must halt
 * trading rather than keep executing against an inconsistent ledger.
 *
 * This is a pure read: callers decide what to do with the verdict. In
 * particular a read-only tool must not mutate shared application state as a
 * side effect of being called.
 */
export function checkPaperConsistency(app: AppServices): PaperConsistency {
  const snapshot = app.paper.snapshot();
  const open = snapshot.orders.filter(
    (order) => order.state === "ACCEPTED" || order.state === "PARTIALLY_FILLED",
  );
  const mismatched: string[] = [];
  for (const order of open) {
    const remaining = decimalOrNull(order.remaining);
    const quantity = decimalOrNull(order.quantity);
    if (remaining === null || quantity === null || remaining.lt(0) || remaining.gt(quantity)) {
      mismatched.push(order.internalOrderId);
    }
  }
  return {
    state: mismatched.length === 0 ? "MATCH" : "MISMATCH",
    checkedOrders: open.length,
    mismatchedOrders: mismatched,
  };
}
