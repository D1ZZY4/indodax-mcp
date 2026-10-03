import { z } from "zod";
import { AuthenticationError, AuthorizationError, ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { placePaperOrder } from "./paper.js";
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
import type { AppServices } from "../composition.js";
import {
  draftIntent,
  placeLiveOrder,
  reviewHypothetical,
  stpModeArg,
  timeInForceArg,
} from "./order-intent.js";

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
      timeInForce: timeInForceArg,
      stpMode: stpModeArg,
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_create_order",
      title: "Create order",
      description:
        "Places through risk into the paper backend by default. Live needs acknowledged true, APP_ENV=live, credentials, and risk ALLOW. Returns acceptance, never a fill. Accepts optional clientOrderId, timeInForce GTC/MOC for LIMIT, and self-trade prevention mode.",
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
      timeInForce: timeInForceArg,
      stpMode: stpModeArg,
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_cancel_order",
      title: "Cancel order",
      description:
        "MUTATING a paper order by default with refund. Live cancel needs credentials, APP_ENV=live, acknowledged true, plus symbol and exchange orderId or clientOrderId.",
      ...base,
      destructive: true,
    },
    inputSchema: z
      .object({
        orderId: z.string().min(1).optional(),
        mode: modeArg,
        acknowledged: acknowledgedArg,
        symbol: z.string().min(1).optional(),
        clientOrderId: z.string().min(1).optional(),
      })
      .refine((args) => args.orderId !== undefined || args.clientOrderId !== undefined, {
        message: "cancel needs orderId or clientOrderId",
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
          timeInForce: timeInForceArg,
          stpMode: stpModeArg,
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
          timeInForce: timeInForceArg,
          stpMode: stpModeArg,
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
          timeInForce: timeInForceArg,
          stpMode: stpModeArg,
        }),
        raw,
      );
      const { intent, mode } = draftIntent(app, args);
      if (mode !== "paper") {
        return ok(
          await placeLiveOrder(app, {
            pair: args.pair,
            side: args.side,
            quantity: args.quantity,
            ...(args.price === undefined ? {} : { price: args.price }),
            ...(args.clientOrderId === undefined ? {} : { clientOrderId: args.clientOrderId }),
            ...(args.timeInForce === undefined ? {} : { timeInForce: args.timeInForce }),
            ...(args.stpMode === undefined ? {} : { stpMode: args.stpMode }),
            ...(args.acknowledged === undefined ? {} : { acknowledged: args.acknowledged }),
          }),
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
        z
          .object({
            orderId: z.string().min(1).optional(),
            mode: modeArg,
            acknowledged: acknowledgedArg,
            symbol: z.string().min(1).optional(),
            clientOrderId: z.string().min(1).optional(),
          })
          .refine((value) => value.orderId !== undefined || value.clientOrderId !== undefined, {
            message: "cancel needs orderId or clientOrderId",
          }),
        raw,
      );
      if (args.mode === "live") {
        if (args.acknowledged !== true) {
          throw AuthorizationError("live cancel needs acknowledged true");
        }
        if (app.env.APP_ENV !== "live" || app.env.TRADE_ENABLED !== true) {
          throw AuthorizationError("live cancel needs APP_ENV=live and TRADE_ENABLED=true");
        }
        if (!app.liveExecutor) {
          throw AuthenticationError("live cancel needs API credentials");
        }
        if (!args.symbol) {
          throw ValidationError("live cancel needs symbol plus exchange orderId");
        }
        const cancelled = await app.liveExecutor.cancelByExchangeId(
          args.symbol,
          args.orderId,
          args.clientOrderId,
        );
        return ok({
          orderId: args.orderId ?? args.clientOrderId,
          status: cancelled ? "cancelled" : "unknown",
        });
      }
      const target = args.orderId ?? args.clientOrderId;
      if (!target) throw ValidationError("cancel needs orderId or clientOrderId");
      const cancelled = await app.paper.cancel(target);
      if (!cancelled) {
        throw ValidationError(`paper order ${target} is not open`);
      }
      return ok({ orderId: target, status: "cancelled" });
    } catch (error) {
      return fail(error);
    }
  });
}
