export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type TimeInForce = "GTC" | "MOC" | "FOK";
export type StpMode = "EXPIRE_TAKER" | "EXPIRE_MAKER" | "EXPIRE_BOTH";
export type LegacyStpMode = "MAKER" | "TAKER" | "BOTH";

export type ExecutionState =
  | "NEW"
  | "SUBMITTING"
  | "ACCEPTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLING"
  | "CANCELLED"
  | "REJECTED"
  | "UNKNOWN"
  | "RECONCILING"
  | "RECONCILED"
  | "PROPOSED";

const TERMINAL: ReadonlySet<ExecutionState> = new Set([
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "RECONCILED",
]);

export function isTerminalState(state: ExecutionState): boolean {
  return TERMINAL.has(state);
}

export type CancelState = "CANCELLED" | "CANCEL_UNKNOWN";

export type RiskOutcome = "ALLOW" | "DENY" | "REVIEW" | "HALT" | "UNKNOWN";

export type RiskReason =
  | "MAX_ORDER_SIZE"
  | "MIN_ORDER_SIZE"
  | "MAX_POSITION_EXPOSURE"
  | "DAILY_LOSS_LIMIT"
  | "MAX_TRADE_COUNT"
  | "COOLDOWN_ACTIVE"
  | "DUPLICATE_ORDER"
  | "STALE_MARKET_DATA"
  | "STALE_ACCOUNT_STATE"
  | "MARKET_SUSPENDED"
  | "INVALID_PAIR"
  | "QUANTITY_INCREMENT"
  | "PRICE_INCREMENT"
  | "INSUFFICIENT_BALANCE"
  | "CIRCUIT_BREAKER"
  | "KILL_SWITCH"
  | "RECONCILIATION_FAILURE"
  | "CAPABILITY_DENIED"
  | "LIVE_MODE_DENIED"
  | "DEADMAN_UNKNOWN"
  | "INVALID_ORDER";

export interface RiskDecision {
  outcome: RiskOutcome;
  reasons: RiskReason[];
  message: string;
}

export type ExecutionMode = "paper" | "live" | "shadow" | "development";

export type Capability = "READ" | "TRADE" | "WITHDRAW" | "PAPER";

export type ReconciliationState = "MATCH" | "MISMATCH" | "UNKNOWN" | "DEGRADED" | "HALTED";

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown" | "halted";
