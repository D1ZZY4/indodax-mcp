import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  isAppError,
  RiskDeniedError,
  UnknownExecutionResultError,
  ValidationError,
} from "@indodax-mcp/errors";
import { ExecutionService } from "@indodax-mcp/indodax-execution";
import { checkQuantityIncrement } from "@indodax-mcp/indodax-market";
import type { Capability, ExecutionMode } from "@indodax-mcp/core";
import { parseSymbolFlexible } from "@indodax-mcp/core";
import type { TradeIntent } from "@indodax-mcp/indodax-trading";
import { resolveRiskContext } from "../risk-context.js";
import type { AppServices } from "../composition.js";

export const timeInForceArg = z.enum(["GTC", "MOC", "FOK"]).optional();
export const stpModeArg = z.enum(["EXPIRE_TAKER", "EXPIRE_MAKER", "EXPIRE_BOTH"]).optional();

export function executionMode(raw: string | undefined): ExecutionMode {
  if (raw === "live") return "live";
  if (raw === "shadow") return "shadow";
  return "paper";
}

export function capabilityFor(mode: ExecutionMode): Capability {
  return mode === "paper" ? "PAPER" : "TRADE";
}

export interface DraftArgs {
  pair: string;
  side: "BUY" | "SELL";
  quantity: number;
  price?: number | undefined;
  mode?: string | undefined;
  reason?: string | undefined;
  clientOrderId?: string | undefined;
  timeInForce?: "GTC" | "MOC" | "FOK" | undefined;
  stpMode?: "EXPIRE_TAKER" | "EXPIRE_MAKER" | "EXPIRE_BOTH" | undefined;
}

export function draftIntent(
  _app: AppServices,
  args: DraftArgs,
): { intent: TradeIntent; mode: ExecutionMode; capability: Capability } {
  const mode = executionMode(args.mode);
  const capability = capabilityFor(mode);
  const symbol = parseSymbolFlexible(args.pair);
  if (!symbol) throw ValidationError(`invalid pair: ${args.pair}`);
  return {
    intent: {
      agentId: "mcp",
      sessionId: `mcp-${Date.now().toString(36)}`,
      symbol,
      side: args.side,
      orderType: args.price === undefined ? "MARKET" : "LIMIT",
      price: args.price === undefined ? null : String(args.price),
      quantityOrIdr: String(args.quantity ?? 0),
      quantityIsIdr: false,
      mode,
      capability,
      reason: args.reason ?? "mcp request",
      ...(args.timeInForce !== undefined ? { timeInForce: args.timeInForce } : {}),
      ...(args.stpMode !== undefined ? { stpMode: args.stpMode } : {}),
    },
    mode,
    capability,
  };
}

export interface HypotheticalArgs extends DraftArgs {}

export interface LivePlacement {
  pair: string;
  side: "BUY" | "SELL";
  quantity: number;
  price?: number | undefined;
  clientOrderId?: string | undefined;
  timeInForce?: "GTC" | "MOC" | "FOK" | undefined;
  stpMode?: "EXPIRE_TAKER" | "EXPIRE_MAKER" | "EXPIRE_BOTH" | undefined;
  acknowledged?: boolean | undefined;
}

/**
 * A dropped request after a live submission may still have executed on the
 * exchange, so timeouts and network failures must surface as an explicit
 * unknown outcome (with the client order id preserved) rather than as a
 * retryable error that invites a blind duplicate submission. Explicit
 * rejections pass through unchanged.
 */
export function ambiguousToUnknown(
  error: unknown,
  correlationId: string,
  clientOrderId: string,
): unknown {
  if (
    isAppError(error) &&
    (error.code === "ExchangeTimeoutError" || error.code === "ExchangeNetworkError")
  ) {
    return UnknownExecutionResultError(
      `live result unknown for ${clientOrderId}; reconcile before retry`,
      { correlationId, safeMetadata: { clientOrderId } },
    );
  }
  return error;
}

/**
 * Shared live placement used by direct orders and triggered stops.
 * Every gate stays mandatory: acknowledgement, APP_ENV, policy,
 * credentials, and a fresh risk ALLOW. Throws otherwise.
 */
export async function placeLiveOrder(app: AppServices, placement: LivePlacement) {
  if (placement.acknowledged !== true) {
    throw AuthorizationError("live execution needs acknowledged true");
  }
  if (app.env.APP_ENV !== "live") {
    throw AuthorizationError("live execution needs APP_ENV=live plus restart");
  }
  if (app.env.TRADE_ENABLED !== true) {
    throw AuthorizationError("live execution needs TRADE_ENABLED=true");
  }
  if (!app.policy.allowedModes.includes("live")) {
    throw AuthorizationError("live mode is disabled by server policy");
  }
  if (!app.accountClient || !app.liveExecutor) {
    throw AuthenticationError("live execution needs API credentials");
  }
  const { intent, capability } = draftIntent(app, placement);
  await checkQuantityIncrement(app.publicClient, placement.pair, placement.quantity);
  const proposal = app.trading.propose(intent);
  const order = app.trading.toOrder(proposal, {
    tenantId: app.tenantId,
    exchangeAccountId: app.accountId,
  });
  if (placement.clientOrderId !== undefined && placement.clientOrderId !== "") {
    order.clientOrderId = placement.clientOrderId.slice(0, 36);
  }
  const decision = app.trading.review(
    order,
    await resolveRiskContext(app, {
      mode: "live",
      capability,
      pair: placement.pair,
      clientOrderId: order.clientOrderId,
    }),
  );
  if (decision.outcome !== "ALLOW") throw RiskDeniedError(decision.message);
  const execution = new ExecutionService(app.liveExecutor);
  try {
    return await execution.execute(
      {
        order,
        mode: "live",
        capability,
        correlationId: proposal.correlationId,
        requestedAt: new Date().toISOString(),
      },
      decision,
    );
  } catch (error) {
    throw ambiguousToUnknown(error, proposal.correlationId, order.clientOrderId);
  }
}

export async function reviewHypothetical(app: AppServices, args: HypotheticalArgs) {
  const { intent, capability } = draftIntent(app, args);
  const proposal = app.trading.propose(intent);
  const order = app.trading.toOrder(proposal, {
    tenantId: app.tenantId,
    exchangeAccountId: app.accountId,
  });
  if (args.clientOrderId !== undefined && args.clientOrderId !== "") {
    order.clientOrderId = args.clientOrderId.slice(0, 36);
  }
  const decision = app.trading.review(
    order,
    await resolveRiskContext(app, {
      mode: intent.mode,
      capability,
      pair: args.pair,
      clientOrderId: order.clientOrderId,
    }),
  );
  // Hypothetical orders never reach a backend. Mark them PROPOSED (not
  // ACCEPTED) so no consumer mistakes validation output for execution.
  // PROPOSED has no machine edges by design; it is display-only.
  order.state = "PROPOSED";
  order.updatedAt = new Date().toISOString();
  return { proposal, order, decision };
}
