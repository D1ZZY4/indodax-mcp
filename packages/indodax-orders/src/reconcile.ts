import type { ReconciliationState } from "@indodax-mcp/core";
import type Decimal from "decimal.js";

export interface OrderComparison {
  state: ReconciliationState;
  checkedOrders: number;
  mismatchedOrders: string[];
  exchangeOnlyIds: string[];
  message: string;
}

export function compareOrderIds(localIds: string[], exchangeIds: string[]): OrderComparison {
  const exchange = new Set(exchangeIds);
  const local = new Set(localIds);
  const mismatched = localIds.filter((id) => !exchange.has(id));
  const exchangeOnly = exchangeIds.filter((id) => !local.has(id));
  if (mismatched.length === 0 && exchangeOnly.length === 0) {
    return {
      state: "MATCH",
      checkedOrders: localIds.length,
      mismatchedOrders: [],
      exchangeOnlyIds: [],
      message: "local and exchange orders match",
    };
  }
  return {
    state: "MISMATCH",
    checkedOrders: localIds.length,
    mismatchedOrders: mismatched,
    exchangeOnlyIds: exchangeOnly,
    message:
      mismatched.length > 0
        ? "local orders missing on exchange"
        : "exchange orders missing locally",
  };
}

export function compareBalance(
  local: Decimal,
  exchange: Decimal,
  tolerance: Decimal,
): ReconciliationState {
  return local.sub(exchange).abs().lte(tolerance) ? "MATCH" : "MISMATCH";
}
