import Decimal from "decimal.js";
import { RiskDeniedError, ValidationError } from "@indodax-mcp/errors";
import { parseSymbolFlexible } from "@indodax-mcp/core";
import { ExecutionService } from "@indodax-mcp/indodax-execution";
import type { ExecutionResult } from "@indodax-mcp/indodax-execution";
import { checkQuantityIncrement, getTicker } from "@indodax-mcp/indodax-market";
import { resolveRiskContext } from "@indodax-mcp/indodax-mcp/risk-context";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

export interface PaperPlacement {
  pair: string;
  side: "BUY" | "SELL";
  orderType?: "LIMIT" | "MARKET" | undefined;
  price?: number | undefined;
  quantity: number;
  clientOrderId?: string | undefined;
}

/** Execution result plus the order type the caller requested. */
export interface PaperPlacementResult extends ExecutionResult {
  orderType: "LIMIT" | "MARKET";
}

/** Replay entries may predate orderType, so treat the field as optional there. */
interface StoredPaperResult extends ExecutionResult {
  orderType?: "LIMIT" | "MARKET";
}

export async function placePaperOrder(
  app: AppServices,
  placement: PaperPlacement,
): Promise<PaperPlacementResult> {
  if (placement.clientOrderId !== undefined && placement.clientOrderId !== "") {
    // Stored replay entries are written by this function, so they already carry
    // orderType. The spread defends against snapshots persisted before this
    // field existed rather than trusting the ledger shape.
    const replay = app.paper.replayResult(placement.clientOrderId) as StoredPaperResult | null;
    if (replay) return { ...replay, orderType: replay.orderType ?? placement.orderType ?? "LIMIT" };
  }
  const symbol = parseSymbolFlexible(placement.pair);
  if (!symbol) throw ValidationError(`invalid pair: ${placement.pair}`);
  if (app.deadman.shouldHaltLiveTrading()) {
    throw RiskDeniedError(`deadman ${app.deadman.snapshot().state} halts trading`);
  }
  await checkQuantityIncrement(app.publicClient, placement.pair, placement.quantity);
  let marketFillPrice: string | null = null;
  if ((placement.orderType ?? "LIMIT") === "MARKET") {
    try {
      const ticker = await getTicker(app.publicClient, `${symbol.base}_${symbol.quote}`);
      marketFillPrice = ticker.last;
    } catch {
      throw ValidationError("paper MARKET needs a live market price; retry online or use LIMIT");
    }
  }
  const requestedType = placement.orderType ?? "LIMIT";
  // A paper MARKET order resolves its price from the live ticker and then
  // settles immediately, so it is submitted through the executor as a LIMIT at
  // the resolved price. The requested type is preserved on the order record so
  // the ledger reports what the caller actually asked for.
  const executorPrice =
    marketFillPrice !== null
      ? new Decimal(marketFillPrice)
      : placement.price === undefined
        ? null
        : new Decimal(String(placement.price));
  const quantity = new Decimal(String(placement.quantity));
  const notional = executorPrice === null ? null : executorPrice.mul(quantity);
  const ledger = app.paper.snapshot();
  const intent = {
    agentId: "mcp",
    sessionId: `mcp-${Date.now().toString(36)}`,
    symbol,
    side: placement.side,
    orderType: "LIMIT" as const,
    price: executorPrice?.toString() ?? null,
    quantityOrIdr: quantity.toString(),
    quantityIsIdr: false,
    mode: "paper" as const,
    capability: "PAPER" as const,
    reason: "paper_order",
  };
  const proposal = app.trading.propose(intent);
  const order = app.trading.toOrder(proposal, {
    tenantId: app.tenantId,
    exchangeAccountId: app.accountId,
  });
  if (placement.clientOrderId !== undefined && placement.clientOrderId !== "") {
    order.clientOrderId = placement.clientOrderId.slice(0, 36);
  }
  // Risk and execution run against the priced record; the requested order type
  // is applied afterwards so the ledger and any response report the real type.
  const decision = app.trading.review(
    order,
    await resolveRiskContext(app, {
      mode: "paper",
      capability: "PAPER",
      pair: placement.pair,
      clientOrderId: placement.clientOrderId ?? order.clientOrderId,
      balanceSufficient: hasPaperBalance(
        ledger.balances,
        symbol,
        placement.side,
        notional,
        quantity,
      ),
    }),
  );
  if (decision.outcome !== "ALLOW") throw RiskDeniedError(decision.message);
  order.orderType = requestedType;
  const execution = new ExecutionService(app.paper);
  const result = await execution.execute(
    {
      order,
      mode: "paper",
      capability: "PAPER",
      correlationId: proposal.correlationId,
      requestedAt: new Date().toISOString(),
    },
    decision,
  );
  if (marketFillPrice !== null) {
    const { fee } = app.paper.fill(
      result.exchangeOrderId ?? result.internalOrderId,
      marketFillPrice,
    );
    const filled = {
      ...result,
      status: "filled",
      orderType: requestedType,
      fillPrice: marketFillPrice,
      fee,
    };
    if (placement.clientOrderId !== undefined && placement.clientOrderId !== "") {
      app.paper.rememberResult(placement.clientOrderId, filled);
    }
    return filled;
  }
  const resolved: PaperPlacementResult = { ...result, orderType: requestedType };
  if (placement.clientOrderId !== undefined && placement.clientOrderId !== "") {
    // Replay stores the caller-visible result, so a repeated clientOrderId
    // returns the same shape as the original response.
    app.paper.rememberResult(placement.clientOrderId, resolved);
  }
  return resolved;
}

function hasPaperBalance(
  balances: Record<string, string>,
  symbol: { base: string; quote: string },
  side: "BUY" | "SELL",
  notional: Decimal | null,
  quantity: Decimal,
): boolean | null {
  try {
    if (side === "BUY") {
      if (notional === null) return null;
      return new Decimal(balances[symbol.quote] ?? "0").gte(notional);
    }
    return new Decimal(balances[symbol.base] ?? "0").gte(quantity);
  } catch {
    return null;
  }
}
