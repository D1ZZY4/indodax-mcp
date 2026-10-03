import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  RiskDeniedError,
  ValidationError,
} from "@indodax-mcp/errors";
import { ExecutionService } from "@indodax-mcp/indodax-execution";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import type { Capability, ExecutionMode } from "@indodax-mcp/core";
import { parseSymbolFlexible } from "@indodax-mcp/core";
import { placePaperOrder } from "./paper.js";
import type { TradeIntent } from "@indodax-mcp/indodax-trading";
import { fail, ok, parseArgs } from "../respond.js";
import {
  acknowledgedArg,
  clientOrderIdArg,
  modeArg,
  pairArg,
  priceArg,
  quantityArg,
  sideArg,
} from "../schemas.js";
import { resolveRiskContext } from "../risk-context.js";
import type { AppServices } from "../composition.js";

function executionMode(raw: string | undefined): ExecutionMode {
  if (raw === "live") return "live";
  if (raw === "shadow") return "shadow";
  return "paper";
}

function capabilityFor(mode: ExecutionMode): Capability {
  return mode === "paper" ? "PAPER" : "TRADE";
}

function draftIntent(
  _app: AppServices,
  args: {
    pair: string;
    side: "BUY" | "SELL";
    quantity: number;
    price?: number | undefined;
    mode?: string | undefined;
    reason?: string | undefined;
    clientOrderId?: string | undefined;
  },
): { intent: TradeIntent; mode: ExecutionMode; capability: Capability } {
  const mode = executionMode(args.mode);
  const capability = capabilityFor(mode);
  const symbol = parseSymbolFlexible(args.pair);
  if (!symbol) throw ValidationError(`invalid pair: ${args.pair}`);
  if (mode === "paper" && args.price === undefined) {
    throw ValidationError(
      "paper orders require a limit price; MARKET orders are not supported in simulation",
    );
  }
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
    },
    mode,
    capability,
  };
}

interface HypotheticalArgs {
  pair: string;
  side: "BUY" | "SELL";
  quantity: number;
  price?: number | undefined;
  mode?: string | undefined;
  reason?: string | undefined;
  clientOrderId?: string | undefined;
}

async function reviewHypothetical(app: AppServices, args: HypotheticalArgs) {
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
  return { proposal, order, decision };
}

export function registerOrderTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  const base = {
    capability: "TRADE" as const,
    riskClass: "mutation" as const,
    environmentRequirement: "paper" as const,
    authRequirement: "none" as const,
    destructive: false,
    idempotencyClass: "client-key" as const,
    auditClass: "mutation" as const,
  };
  registry.registerTool({
    metadata: {
      name: "indodax_validate_order",
      title: "Validate order",
      description:
        "No side effects. Validate shape plus risk for a hypothetical order. Returns the risk decision with reasons.",
      ...base,
      riskClass: "read",
      auditClass: "read",
    },
    inputSchema: z.object({
      pair: pairArg,
      side: sideArg,
      quantity: quantityArg,
      price: priceArg.optional(),
      mode: modeArg,
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_propose_order",
      title: "Propose order",
      description:
        "No side effects and no execution. Build a validated proposal through risk. A proposal is not an order.",
      ...base,
      riskClass: "read",
      auditClass: "read",
    },
    inputSchema: z.object({
      pair: pairArg,
      side: sideArg,
      quantity: quantityArg,
      price: priceArg.optional(),
      mode: modeArg,
      reason: z.string().optional(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_create_order",
      title: "Create order",
      description:
        "MUTATING in paper mode only. Places through risk into the paper backend by default. Live needs acknowledged true plus explicit live enablement, otherwise denied. Returns acceptance, never a fill. Accepts optional clientOrderId for idempotent replay.",
      ...base,
      destructive: true,
    },
    inputSchema: z.object({
      pair: pairArg,
      side: sideArg,
      quantity: quantityArg,
      price: priceArg.optional(),
      mode: modeArg,
      acknowledged: acknowledgedArg,
      clientOrderId: clientOrderIdArg,
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_cancel_order",
      title: "Cancel order",
      description:
        "MUTATING a paper order by default with refund. Live cancel needs credentials, live mode, and acknowledged true.",
      ...base,
      destructive: true,
    },
    inputSchema: z.object({
      orderId: z.string().min(1),
      mode: modeArg,
      acknowledged: acknowledgedArg,
    }),
  });

  handlers.tools.set("indodax_validate_order", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          pair: pairArg,
          side: sideArg,
          quantity: quantityArg,
          price: priceArg.optional(),
          mode: modeArg,
        }),
        raw,
      );
      const { proposal, order, decision } = await reviewHypothetical(app, args);
      return ok({ proposal: proposal.correlationId, order, decision });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_propose_order", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          pair: pairArg,
          side: sideArg,
          quantity: quantityArg,
          price: priceArg.optional(),
          mode: modeArg,
          reason: z.string().optional(),
        }),
        raw,
      );
      const { proposal, order, decision } = await reviewHypothetical(app, args);
      return ok({ proposal: proposal.correlationId, order, decision });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_create_order", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          pair: pairArg,
          side: sideArg,
          quantity: quantityArg,
          price: priceArg.optional(),
          mode: modeArg,
          acknowledged: acknowledgedArg,
          clientOrderId: clientOrderIdArg,
        }),
        raw,
      );
      const { intent, mode, capability } = draftIntent(app, args);
      if (mode !== "paper") {
        if (args.acknowledged !== true) {
          throw AuthorizationError("live execution needs acknowledged true");
        }
        if (app.env.APP_ENV !== "live") {
          throw AuthorizationError("live execution needs APP_ENV=live plus restart");
        }
        if (!app.policy.allowedModes.includes("live")) {
          throw AuthorizationError("live mode is disabled by server policy");
        }
        if (!app.accountClient || !app.liveExecutor) {
          throw AuthenticationError("live execution needs API credentials");
        }
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
            mode: "live",
            capability,
            pair: args.pair,
            clientOrderId: order.clientOrderId,
          }),
        );
        if (decision.outcome !== "ALLOW") throw RiskDeniedError(decision.message);
        const execution = new ExecutionService(app.liveExecutor);
        return ok(
          await execution.execute(
            {
              order,
              mode: "live",
              capability,
              correlationId: proposal.correlationId,
              requestedAt: new Date().toISOString(),
            },
            decision,
          ),
        );
      }
      return ok(
        await placePaperOrder(app, {
          pair: args.pair,
          side: args.side,
          orderType: intent.orderType,
          ...(args.price === undefined ? {} : { price: args.price }),
          quantity: args.quantity,
          ...(args.clientOrderId === undefined ? {} : { clientOrderId: args.clientOrderId }),
        }),
      );
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_cancel_order", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          orderId: z.string().min(1),
          mode: modeArg,
          acknowledged: acknowledgedArg,
          symbol: z.string().min(1).optional(),
        }),
        raw,
      );
      if (args.mode === "live") {
        if (args.acknowledged !== true) {
          throw AuthorizationError("live cancel needs acknowledged true");
        }
        if (app.env.APP_ENV !== "live") {
          throw AuthorizationError("live cancel needs APP_ENV=live plus restart");
        }
        if (!app.liveExecutor) {
          throw AuthenticationError("live cancel needs API credentials");
        }
        if (!args.symbol) {
          throw ValidationError("live cancel needs symbol plus exchange orderId");
        }
        const cancelled = await app.liveExecutor.cancelByExchangeId(args.symbol, args.orderId);
        return ok({ orderId: args.orderId, status: cancelled ? "cancelled" : "unknown" });
      }
      const cancelled = await app.paper.cancel(args.orderId);
      if (!cancelled) {
        throw ValidationError(`paper order ${args.orderId} is not open`);
      }
      return ok({ orderId: args.orderId, status: "cancelled" });
    } catch (error) {
      return fail(error);
    }
  });
}
