import type { ExecutionState, OrderSide, OrderType, StpMode, TimeInForce } from "@indodax-mcp/core";
import type { SymbolParts } from "@indodax-mcp/core";

export interface OrderRecord {
  internalOrderId: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  symbol: SymbolParts;
  side: OrderSide;
  orderType: OrderType;
  price: string | null;
  quantity: string;
  remaining: string;
  state: ExecutionState;
  environment: "paper" | "live";
  tenantId: string;
  exchangeAccountId: string;
  strategyId: string | null;
  runId: string | null;
  riskDecisionId: string | null;
  submittedAt: string;
  updatedAt: string;
  timeInForce?: TimeInForce | undefined;
  stpMode?: StpMode | undefined;
}

export function newOrderRecord(
  init: Omit<OrderRecord, "state" | "submittedAt" | "updatedAt">,
): OrderRecord {
  const now = new Date().toISOString();
  return { ...init, state: "NEW", submittedAt: now, updatedAt: now };
}
