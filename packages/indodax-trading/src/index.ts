import { ValidationError } from "@d1zzy4-jethools/errors";
import type {
  Capability,
  ExecutionMode,
  OrderSide,
  OrderType,
  RiskDecision,
  StpMode,
  TimeInForce,
} from "@d1zzy4-jethools/core";
import { decimalOrNull, isValidClientOrderId, validateOrderInput } from "@d1zzy4-jethools/core";
import type { SymbolParts } from "@d1zzy4-jethools/core";
import { transition, type OrderRecord } from "@d1zzy4-jethools/indodax-orders";
import type { RiskContext, RiskEngine } from "@d1zzy4-jethools/indodax-risk";

export interface TradeIntent {
  agentId: string;
  sessionId: string;
  symbol: SymbolParts;
  side: OrderSide;
  orderType: OrderType;
  price: string | null;
  quantityOrIdr: string;
  quantityIsIdr: boolean;
  mode: ExecutionMode;
  capability: Capability;
  reason: string;
  timeInForce?: TimeInForce | undefined;
  stpMode?: StpMode | undefined;
}

export interface TradeProposal {
  intent: TradeIntent;
  correlationId: string;
  validatedAt: string;
}

export interface AuditSink {
  record(entry: {
    kind: string;
    correlationId: string;
    agentId?: string;
    symbol?: string;
    decision?: string;
    reason?: string;
  }): void;
}

export function intentToOrderShape(intent: TradeIntent): {
  price: ReturnType<typeof decimalOrNull>;
  quantity: ReturnType<typeof decimalOrNull>;
} {
  const price = intent.price === null ? null : decimalOrNull(intent.price);
  let quantity = decimalOrNull(intent.quantityOrIdr);
  if (intent.quantityIsIdr && price !== null && quantity !== null) {
    quantity = quantity.div(price);
  }
  return { price, quantity };
}

export class TradingService {
  private counter = 1;

  constructor(
    private readonly risk: RiskEngine,
    private readonly audit: AuditSink,
  ) {}

  propose(intent: TradeIntent): TradeProposal {
    const correlationId = `corr-${Date.now().toString(36)}${(this.counter++).toString(36)}${Math.floor(
      Math.random() * 1296,
    )
      .toString(36)
      .padStart(2, "0")}`;
    if (!isValidClientOrderId(`draft-${correlationId}`)) {
      throw ValidationError("internal correlation id invalid");
    }
    const { price, quantity } = intentToOrderShape(intent);
    if (quantity === null || quantity.lte(0)) {
      throw ValidationError("amount must be positive");
    }
    if (intent.orderType === "LIMIT" && price === null) {
      throw ValidationError("limit order needs price");
    }
    const validation = validateOrderInput({
      internalOrderId: correlationId,
      clientOrderId: `draft-${correlationId}`,
      symbol: intent.symbol,
      side: intent.side,
      orderType: intent.orderType,
      price,
      quantity,
      quoteOrderQuantity: null,
    });
    if (!validation.ok) throw ValidationError(validation.errors.join("; "));
    this.audit.record({
      kind: "AgentIntentCreated",
      correlationId,
      agentId: intent.agentId,
      symbol: `${intent.symbol.base}_${intent.symbol.quote}`,
      reason: intent.reason,
    });
    return { intent, correlationId, validatedAt: new Date().toISOString() };
  }

  toOrder(
    proposal: TradeProposal,
    ids: { tenantId: string; exchangeAccountId: string },
  ): OrderRecord {
    const { price, quantity } = intentToOrderShape(proposal.intent);
    if (quantity === null) throw ValidationError("invalid quantity");
    if (proposal.intent.timeInForce !== undefined) {
      const tif = proposal.intent.timeInForce;
      // GTC/MOC are LIMIT-only; FOK is MARKET-only per the official enums.
      if (tif === "FOK" && proposal.intent.orderType !== "MARKET") {
        throw ValidationError("timeInForce FOK only applies to MARKET orders");
      }
      if (tif !== "FOK" && proposal.intent.orderType !== "LIMIT") {
        throw ValidationError("timeInForce only applies to LIMIT orders");
      }
    }
    const now = new Date().toISOString();
    return {
      internalOrderId: `order-${proposal.correlationId}`,
      clientOrderId: `order-${proposal.correlationId}`.slice(0, 36),
      exchangeOrderId: null,
      symbol: proposal.intent.symbol,
      side: proposal.intent.side,
      orderType: proposal.intent.orderType,
      price: price?.toString() ?? null,
      quantity: quantity.toString(),
      remaining: quantity.toString(),
      state: "NEW",
      environment: proposal.intent.mode === "live" ? "live" : "paper",
      tenantId: ids.tenantId,
      exchangeAccountId: ids.exchangeAccountId,
      strategyId: null,
      runId: null,
      riskDecisionId: null,
      submittedAt: now,
      updatedAt: now,
      ...(proposal.intent.timeInForce !== undefined
        ? { timeInForce: proposal.intent.timeInForce }
        : {}),
      ...(proposal.intent.stpMode !== undefined ? { stpMode: proposal.intent.stpMode } : {}),
    };
  }

  review(order: OrderRecord, context: RiskContext): RiskDecision {
    try {
      order.state = transition(order.state, "SUBMITTING");
    } catch {
      throw ValidationError(`order ${order.internalOrderId} is not reviewable from ${order.state}`);
    }
    const price = order.price === null ? null : decimalOrNull(order.price);
    const quantity = decimalOrNull(order.quantity);
    const notional = price !== null && quantity !== null ? price.mul(quantity) : null;
    const decision = this.risk.evaluate(
      {
        notional,
        quantity,
        price,
        isMarket: order.orderType === "MARKET",
        symbol: `${order.symbol.base}_${order.symbol.quote}`,
      },
      context,
    );
    this.audit.record({
      kind: decision.outcome === "ALLOW" ? "RiskApproved" : "RiskRejected",
      correlationId: order.internalOrderId,
      symbol: `${order.symbol.base}_${order.symbol.quote}`,
      decision: decision.outcome,
      reason: decision.message,
    });
    order.state = transition(order.state, decision.outcome === "ALLOW" ? "ACCEPTED" : "REJECTED");
    order.updatedAt = new Date().toISOString();
    return decision;
  }
}
