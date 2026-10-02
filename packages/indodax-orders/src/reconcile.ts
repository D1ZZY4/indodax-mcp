import type { ReconciliationState } from "@indodax-mcp/core";
import type Decimal from "decimal.js";

export interface OrderComparison {
  state: ReconciliationState;
  checkedOrders: number;
  mismatchedOrders: string[];
  message: string;
}

export function compareOrderIds(localIds: string[], exchangeIds: string[]): OrderComparison {
  const exchange = new Set(exchangeIds);
  const mismatched = localIds.filter((id) => !exchange.has(id));
  if (mismatched.length === 0) {
    return {
      state: "MATCH",
      checkedOrders: localIds.length,
      mismatchedOrders: [],
      message: "local and exchange orders match",
    };
  }
  return {
    state: "MISMATCH",
    checkedOrders: localIds.length,
    mismatchedOrders: mismatched,
    message: "local orders missing on exchange",
  };
}

export function compareBalance(
  local: Decimal,
  exchange: Decimal,
  tolerance: Decimal,
): ReconciliationState {
  return local.sub(exchange).abs().lte(tolerance) ? "MATCH" : "MISMATCH";
}
