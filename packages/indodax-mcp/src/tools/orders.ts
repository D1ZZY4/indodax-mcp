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
import { defineTool, refineTool } from "./define.js";
import {
  ambiguousToUnknown,
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
    environmentRequirement: "any" as const,
    authRequirement: "none" as const,
    destructive: false,
    idempotencyClass: "client-key" as const,
    auditClass: "mutation" as const,
  };
  // Declared once so the advertised schema and the handler parse cannot drift.
  // timeInForce and stpMode were previously accepted by the handler but absent
  // from the registered schema, so the SDK stripped them before the handler ran.
  const validateOrder = defineTool(
    {
      name: "indodax_validate_order",
      title: "Validate order",
      description:
        "Executes nothing. Validate shape plus risk for a hypothetical order. Returns the risk decision with reasons and executed:false. Writes audit entries for traceability.",
      ...base,
      riskClass: "read",
      auditClass: "read",
    },
    {
      pair: pairArg,
      side: sideArg,
      quantity: quantityArg,
      price: priceArg.optional(),
      mode: modeArg,
      timeInForce: timeInForceArg,
      stpMode: stpModeArg,
    },
  );
  registry.registerTool(validateOrder);
  const proposeOrder = defineTool(
    {
      name: "indodax_propose_order",
      title: "Propose order",
      description:
        "Executes nothing and creates no order. Build a validated proposal through risk with executed:false. A proposal is not an order. Writes audit entries for traceability.",
      ...base,
      riskClass: "read",
      auditClass: "read",
    },
    {
      pair: pairArg,
      side: sideArg,
      quantity: quantityArg,
      price: priceArg.optional(),
      mode: modeArg,
      reason: z.string().optional(),
      timeInForce: timeInForceArg,
      stpMode: stpModeArg,
    },
  );
  registry.registerTool(proposeOrder);
  const createOrder = defineTool(
    {
      name: "indodax_create_order",
      title: "Create order",
      description:
        "Places through risk into the paper backend by default. Live needs ALL of: mode live, acknowledged true, APP_ENV=live, TRADE_ENABLED=true, credentials, and risk ALLOW. Returns acceptance, never a fill. Accepts optional clientOrderId, timeInForce GTC/MOC for LIMIT or FOK for MARKET, and self-trade prevention mode.",
      ...base,
      destructive: true,
    },
    {
      pair: pairArg,
      side: sideArg,
      quantity: quantityArg,
      price: priceArg.optional(),
      mode: modeArg,
      acknowledged: acknowledgedArg,
      clientOrderId: clientOrderIdArg,
      timeInForce: timeInForceArg,
      stpMode: stpModeArg,
    },
  );
  registry.registerTool(createOrder);
  // The at-least-one-id rule is a cross-field refinement, so it stays on the
  // advertised schema rather than living only inside the handler.
  const cancelOrder = refineTool(
    defineTool(
      {
        name: "indodax_cancel_order",
        title: "Cancel order",
        description:
          "MUTATING a paper order by default with refund (orderId or clientOrderId). Live cancel needs ALL of: mode live, acknowledged true, APP_ENV=live, TRADE_ENABLED=true, credentials, plus symbol and exchange orderId or clientOrderId.",
        ...base,
        destructive: true,
      },
      {
        orderId: z.string().min(1).optional(),
        mode: modeArg,
        acknowledged: acknowledgedArg,
        symbol: z.string().min(1).optional(),
        clientOrderId: z.string().min(1).optional(),
      },
    ),
    (args) => args.orderId !== undefined || args.clientOrderId !== undefined,
    "cancel needs orderId or clientOrderId",
  );
  registry.registerTool(cancelOrder);

  handlers.tools.set("indodax_validate_order", async (raw) => {
    try {
      const args = parseArgs(validateOrder.inputSchema, raw);
      const { proposal, order, decision, incrementWarning } = await reviewHypothetical(app, args);
      const warnings = ["proposal only: nothing was placed and no funds moved"];
      if (incrementWarning !== null) warnings.push(`quantity increment: ${incrementWarning}`);
      return ok({ proposal: proposal.correlationId, order, decision, executed: false }, warnings);
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_propose_order", async (raw) => {
    try {
      const args = parseArgs(proposeOrder.inputSchema, raw);
      const { proposal, order, decision, incrementWarning } = await reviewHypothetical(app, args);
      const warnings = ["proposal only: nothing was placed and no funds moved"];
      if (incrementWarning !== null) warnings.push(`quantity increment: ${incrementWarning}`);
      return ok({ proposal: proposal.correlationId, order, decision, executed: false }, warnings);
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_create_order", async (raw) => {
    try {
      const args = parseArgs(createOrder.inputSchema, raw);
      const { intent, mode } = draftIntent(app, args);
      if (mode === "live") {
        const result = (await placeLiveOrder(app, {
          pair: args.pair,
          side: args.side,
          quantity: args.quantity,
          ...(args.price === undefined ? {} : { price: args.price }),
          ...(args.clientOrderId === undefined ? {} : { clientOrderId: args.clientOrderId }),
          ...(args.timeInForce === undefined ? {} : { timeInForce: args.timeInForce }),
          ...(args.stpMode === undefined ? {} : { stpMode: args.stpMode }),
          ...(args.acknowledged === undefined ? {} : { acknowledged: args.acknowledged }),
        })) as unknown as Record<string, unknown>;
        return ok({
          ...result,
          pair: args.pair,
          side: args.side,
          mode: "live",
          summary: `live order accepted with exchange id ${String(result.exchangeOrderId ?? "unknown")}`,
        });
      }
      if (mode !== "paper") {
        throw AuthorizationError(
          `execution mode ${mode} is reserved and has no backend; use paper for simulation`,
        );
      }
      const paperResult = (await placePaperOrder(app, {
        pair: args.pair,
        side: args.side,
        orderType: intent.orderType,
        ...(args.price === undefined ? {} : { price: args.price }),
        quantity: args.quantity,
        ...(args.clientOrderId === undefined ? {} : { clientOrderId: args.clientOrderId }),
      })) as unknown as Record<string, unknown>;
      return ok({
        ...paperResult,
        pair: args.pair,
        side: args.side,
        mode: "paper",
        summary: `paper order accepted with id ${String(paperResult.exchangeOrderId ?? paperResult.internalOrderId ?? "unknown")}`,
        note: "Acceptance is not a fill; use indodax_paper_fill next.",
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_cancel_order", async (raw) => {
    try {
      const args = parseArgs(cancelOrder.inputSchema, raw);
      if (args.mode !== undefined && args.mode !== "paper" && args.mode !== "live") {
        throw AuthorizationError(
          `execution mode ${args.mode} is reserved and has no backend; use paper for simulation`,
        );
      }
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
        const cancelId = args.orderId ?? args.clientOrderId ?? "unknown";
        try {
          const cancelled = await app.liveExecutor.cancelByExchangeId(
            args.symbol,
            args.orderId,
            args.clientOrderId,
          );
          return ok({
            orderId: args.orderId ?? args.clientOrderId,
            status: cancelled ? "cancelled" : "unknown",
          });
        } catch (error) {
          throw ambiguousToUnknown(error, `cancel-${cancelId}`, cancelId);
        }
      }
      const target = args.orderId ?? args.clientOrderId;
      if (!target) throw ValidationError("cancel needs orderId or clientOrderId");
      const cancelled = await app.paper.cancel(target);
      if (!cancelled) {
        throw ValidationError(`paper order ${target} is not open`);
      }
      return ok({
        orderId: target,
        status: "cancelled",
        balances: app.paper.snapshot().balances,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
