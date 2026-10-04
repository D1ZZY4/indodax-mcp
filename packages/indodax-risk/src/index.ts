import Decimal from "decimal.js";
import type {
  Capability,
  ExecutionMode,
  RiskDecision,
  RiskOutcome,
  RiskReason,
} from "@indodax-mcp/core";

export interface RiskLimits {
  maxOrderNotional: Decimal;
  minOrderNotional: Decimal;
  maxPositionNotional: Decimal;
  maxDailyLoss: Decimal;
  maxTradeCount: number;
  orderCooldownMs: number;
  maxMarketAgeMs: number;
  maxAccountAgeMs: number;
}

export function defaultRiskLimits(): RiskLimits {
  return {
    maxOrderNotional: new Decimal(10_000_000),
    minOrderNotional: new Decimal(10_000),
    maxPositionNotional: new Decimal(100_000_000),
    maxDailyLoss: new Decimal(5_000_000),
    maxTradeCount: 100,
    orderCooldownMs: 5_000,
    maxMarketAgeMs: 60_000,
    maxAccountAgeMs: 120_000,
  };
}

export interface RiskPolicy {
  killSwitch: boolean;
  circuitBreaker: boolean;
  allowedModes: ExecutionMode[];
  allowedCapabilities: Capability[];
}

export function paperOnlyPolicy(): RiskPolicy {
  return {
    killSwitch: false,
    circuitBreaker: false,
    allowedModes: ["paper"],
    allowedCapabilities: ["READ", "PAPER"],
  };
}

export function liveEnabledPolicy(): RiskPolicy {
  return {
    killSwitch: false,
    circuitBreaker: false,
    allowedModes: ["paper", "live"],
    allowedCapabilities: ["READ", "PAPER", "TRADE"],
  };
}

export interface OrderFacts {
  notional: Decimal | null;
  quantity: Decimal | null;
  price: Decimal | null;
  isMarket: boolean;
  symbol: string;
}

export interface RiskContext {
  mode: ExecutionMode;
  capability: Capability;
  marketAgeMs: number | null;
  accountAgeMs: number | null;
  dailyPnl: Decimal | null;
  tradeCount: number;
  duplicate: boolean;
  reconciliationHalted: boolean;
  deadmanUnknown: boolean;
  balanceSufficient: boolean | null;
  /** True when the exchange suspended this market. Null skips the check. */
  marketSuspended?: boolean | null | undefined;
  /** Current position notional in quote currency. Null skips the max-position check. */
  positionNotional?: Decimal | null | undefined;
  /** Epoch ms of the most recent order. Null skips the cooldown check. */
  lastOrderAtMs?: number | null | undefined;
  /**
   * Live Deadman Switch state. STALE or EXPIRED denies live trading.
   * Null or undefined skips the check (use deadmanUnknown for unknown state).
   */
  deadmanState?: "DISARMED" | "ARMED" | "STALE" | "EXPIRED" | null | undefined;
}

export interface RiskEngine {
  evaluate(order: OrderFacts, context: RiskContext): RiskDecision;
}

function deny(reason: RiskReason, message: string): RiskDecision {
  return { outcome: "DENY", reasons: [reason], message };
}

function halt(reason: RiskReason, message: string): RiskDecision {
  return { outcome: "HALT", reasons: [reason], message };
}

export function createRiskEngine(limits: RiskLimits, policy: RiskPolicy): RiskEngine {
  return {
    evaluate(order, context): RiskDecision {
      const outcome = evaluateInternal(limits, policy, order, context);
      return outcome;
    },
  };
}

function evaluateInternal(
  limits: RiskLimits,
  policy: RiskPolicy,
  order: OrderFacts,
  context: RiskContext,
): RiskDecision {
  let outcome: RiskOutcome = "ALLOW";
  const reasons: RiskReason[] = [];
  const push = (reason: RiskReason) => {
    reasons.push(reason);
    outcome = "DENY";
  };

  if (policy.killSwitch) return halt("KILL_SWITCH", "kill switch engaged");
  if (policy.circuitBreaker) return halt("CIRCUIT_BREAKER", "circuit breaker open");
  if (context.reconciliationHalted) {
    return halt("RECONCILIATION_FAILURE", "reconciliation halted trading");
  }
  if (!policy.allowedModes.includes(context.mode)) {
    return deny("LIVE_MODE_DENIED", `execution mode ${context.mode} not allowed`);
  }
  if (!policy.allowedCapabilities.includes(context.capability)) {
    return deny("CAPABILITY_DENIED", `capability ${context.capability} denied`);
  }
  if (context.deadmanUnknown && context.mode === "live") {
    return deny("DEADMAN_UNKNOWN", "deadman state unknown for live trading");
  }
  if (
    context.mode === "live" &&
    (context.deadmanState === "STALE" || context.deadmanState === "EXPIRED")
  ) {
    return deny("DEADMAN_UNKNOWN", `deadman ${context.deadmanState} halts live trading`);
  }
  if (context.duplicate) push("DUPLICATE_ORDER");
  if (context.marketSuspended === true) push("MARKET_SUSPENDED");
  if (context.marketAgeMs !== null && context.marketAgeMs > limits.maxMarketAgeMs) {
    push("STALE_MARKET_DATA");
  }
  if (context.accountAgeMs !== null && context.accountAgeMs > limits.maxAccountAgeMs) {
    push("STALE_ACCOUNT_STATE");
  }
  if (order.notional !== null) {
    if (order.notional.gt(limits.maxOrderNotional)) push("MAX_ORDER_SIZE");
    if (order.notional.lt(limits.minOrderNotional)) push("MIN_ORDER_SIZE");
  } else if (order.isMarket) {
    push("INVALID_ORDER");
  }
  if (context.dailyPnl?.lt(limits.maxDailyLoss.neg()) ?? false) {
    push("DAILY_LOSS_LIMIT");
  }
  if (context.tradeCount >= limits.maxTradeCount) push("MAX_TRADE_COUNT");
  if (context.balanceSufficient === false) push("INSUFFICIENT_BALANCE");
  if (context.positionNotional?.gt(limits.maxPositionNotional) === true) {
    push("MAX_POSITION_EXPOSURE");
  }
  if (context.lastOrderAtMs != null) {
    const elapsed = Date.now() - context.lastOrderAtMs;
    if (elapsed >= 0 && elapsed < limits.orderCooldownMs) push("COOLDOWN_ACTIVE");
  }

  if (outcome === "ALLOW") return { outcome, reasons: [], message: "allowed" };
  return { outcome: "DENY", reasons, message: `denied: ${reasons.join(", ")}` };
}
