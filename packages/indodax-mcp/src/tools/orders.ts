import { z } from "zod";
import { AuthorizationError, ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import type { Capability, ExecutionMode } from "@indodax-mcp/core";
import { parseSymbolFlexible } from "@indodax-mcp/core";
import { placePaperOrder } from "./paper.js";
import type { TradeIntent } from "@indodax-mcp/indodax-trading";
import { fail, ok, pairArg, parseArgs } from "../respond.js";
import type { AppServices } from "../composition.js";

const sideArg = z.enum(["BUY", "SELL"]);
const modeArg = z.enum(["paper", "live", "shadow"]).optional();

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
  },
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
}

function reviewHypothetical(app: AppServices, args: HypotheticalArgs) {
  const { intent, capability } = draftIntent(app, args);
  const proposal = app.trading.propose(intent);
  const order = app.trading.toOrder(proposal, {
    tenantId: app.tenantId,
    exchangeAccountId: app.accountId,
  });
  const decision = app.trading.review(order, {
    mode: intent.mode,
    capability,
    marketAgeMs: 5_000,
    accountAgeMs: 5_000,
    dailyPnl: null,
    tradeCount: 0,
    duplicate: false,
    reconciliationHalted: false,
    deadmanUnknown: false,
    balanceSufficient: null,
  });
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
      quantity: z.number().positive(),
      price: z.number().positive().optional(),
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
      quantity: z.number().positive(),
      price: z.number().positive().optional(),
      mode: modeArg,
      reason: z.string().optional(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_create_order",
      title: "Create order",
      description:
        "MUTATING in paper mode only. Places through risk into the paper backend by default. Live needs acknowledged true plus explicit live enablement, otherwise denied. Returns acceptance, never a fill.",
      ...base,
      destructive: true,
    },
    inputSchema: z.object({
      pair: pairArg,
      side: sideArg,
      quantity: z.number().positive(),
      price: z.number().positive().optional(),
      mode: modeArg,
      acknowledged: z.boolean().optional(),
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
      acknowledged: z.boolean().optional(),
    }),
  });

  handlers.tools.set("indodax_validate_order", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          pair: pairArg,
          side: sideArg,
          quantity: z.number().positive(),
          price: z.number().positive().optional(),
          mode: modeArg,
        }),
        raw,
      );
      const { proposal, order, decision } = reviewHypothetical(app, args);
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
          quantity: z.number().positive(),
          price: z.number().positive().optional(),
          mode: modeArg,
          reason: z.string().optional(),
        }),
        raw,
      );
      const { proposal, order, decision } = reviewHypothetical(app, args);
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
          quantity: z.number().positive(),
          price: z.number().positive().optional(),
          mode: modeArg,
          acknowledged: z.boolean().optional(),
        }),
        raw,
      );
      const { intent, mode } = draftIntent(app, args);
      if (mode !== "paper") {
        if (args.acknowledged !== true) {
          throw AuthorizationError("live execution needs acknowledged true");
        }
        throw AuthorizationError("live mode is disabled by server policy");
      }
      return ok(
        await placePaperOrder(app, {
          pair: args.pair,
          side: args.side,
          orderType: intent.orderType,
          ...(args.price === undefined ? {} : { price: args.price }),
          quantity: args.quantity,
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
          acknowledged: z.boolean().optional(),
        }),
        raw,
      );
      if (args.mode === "live") {
        if (args.acknowledged !== true) {
          throw AuthorizationError("live cancel needs acknowledged true");
        }
        throw AuthorizationError("live mode is disabled by server policy");
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
