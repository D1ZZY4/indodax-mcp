import { z } from "zod";
import { AuthorizationError, ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import {
  clientOrderIdArg,
  pairArg,
  priceArg,
  quantityArg,
  sideArg,
} from "@indodax-mcp/mcp-app/schemas";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";
import { placePaperOrder } from "@indodax-mcp/mcp-app/tools/paper-order";

const PAPER = {
  capability: "PAPER" as const,
  riskClass: "mutation" as const,
  environmentRequirement: "paper" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "client-key" as const,
  auditClass: "mutation" as const,
};

const PAPER_READ = { ...PAPER, riskClass: "read" as const, auditClass: "read" as const };

export type { PaperPlacement } from "@indodax-mcp/mcp-app/tools/paper-order";
export { placePaperOrder } from "@indodax-mcp/mcp-app/tools/paper-order";

const paperOrder = defineTool(
  {
    name: "indodax_paper_order",
    title: "Paper order",
    description:
      "Simulated execution through validation and risk. Args: pair, side, quantity in base units, optional clientOrderId for idempotent replay, orderType LIMIT (default, needs price) or MARKET (fills instantly at the live price, needs market reachability). Returns the open paper order id, or fill details for MARKET.",
    ...PAPER,
  },
  {
    pair: pairArg,
    side: sideArg,
    price: priceArg.optional(),
    quantity: quantityArg,
    clientOrderId: clientOrderIdArg,
    orderType: z.enum(["LIMIT", "MARKET"]).optional(),
  },
);

const paperFill = defineTool(
  {
    name: "indodax_paper_fill",
    title: "Paper fill",
    description:
      "Simulated execution. Fill one open paper order with fees; returns fee, fill price, filled quantity, and balances after the fill. Args: orderId, price.",
    ...PAPER,
  },
  { orderId: z.string().min(1), price: z.number().positive() },
);

const paperCancel = defineTool(
  {
    name: "indodax_paper_cancel",
    title: "Paper cancel",
    description:
      "Simulated execution. Cancel one open paper order with refund; returns balances after the refund. Args: orderId.",
    ...PAPER,
  },
  { orderId: z.string().min(1) },
);

const paperReset = defineTool(
  {
    name: "indodax_paper_reset",
    title: "Paper reset",
    description:
      "Simulated, destructive to simulation only. Reset balances and clear orders after acknowledged:true. Never touches real money. Args: acknowledged required.",
    ...PAPER,
    destructive: true,
  },
  { acknowledged: z.boolean() },
);

export function registerPaperTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  const defs = [
    {
      name: "indodax_paper_account",
      description:
        "Read-only. Complete virtual paper account: balances, initial balances, trade count, open orders, and total fees. Never touches real money.",
    },
    {
      name: "indodax_paper_status",
      description:
        "Read-only. Complete paper status: trade count, open order count with ids (first 100), total fees, balances, and realized PnL today.",
    },
    {
      name: "indodax_paper_orders",
      description:
        "Read-only. Complete open paper orders with count, full order records, pairs, and summary.",
    },
    {
      name: "indodax_paper_snapshots",
      description:
        "Read-only. Complete paper ledger snapshot with balances, orders, cost basis, realized PnL, replay log, and summary counts.",
    },
  ];
  for (const def of defs) {
    registry.registerTool({
      metadata: { name: def.name, title: def.name, description: def.description, ...PAPER_READ },
      inputSchema: z.object({}),
    });
  }
  registry.registerTool(paperOrder);
  registry.registerTool(paperFill);
  registry.registerTool(paperCancel);
  registry.registerTool(paperReset);

  handlers.tools.set("indodax_paper_account", async () => {
    const snapshot = app.paper.snapshot();
    const open = app.paper.openOrders();
    return ok({
      balances: snapshot.balances,
      initialBalances: snapshot.initialBalances,
      tradeCount: snapshot.tradeCount,
      openOrders: open.length,
      openOrderIds: open.map((order) => order.internalOrderId).slice(0, 100),
      totalFees: snapshot.totalFees,
      realizedByDay: snapshot.realizedByDay,
      costBasisAssets: Object.keys(snapshot.costBasis),
      summary: `${Object.keys(snapshot.balances).length} assets, ${open.length} open orders, ${snapshot.tradeCount} lifetime trades, fees ${snapshot.totalFees}`,
      note: "Simulation only. Paper balances never settle on the exchange.",
    });
  });
  handlers.tools.set("indodax_paper_status", async () => {
    const snapshot = app.paper.snapshot();
    const open = app.paper.openOrders();
    const openOrderIds = open.map((order) => order.internalOrderId);
    const filled = snapshot.orders.filter((order) => order.state === "FILLED").length;
    return ok({
      tradeCount: snapshot.tradeCount,
      openOrders: open.length,
      openOrderIds: openOrderIds.slice(0, 100),
      openOrdersTruncated: openOrderIds.length > 100,
      totalFees: snapshot.totalFees,
      filledOrders: filled,
      balances: snapshot.balances,
      initialBalances: snapshot.initialBalances,
      realizedByDay: snapshot.realizedByDay,
      pairs: [...new Set(open.map((order) => `${order.symbol.base}_${order.symbol.quote}`))],
      summary: `trades=${snapshot.tradeCount} open=${open.length} filled=${filled} fees=${snapshot.totalFees}`,
      note: "Simulation only. Acceptance is not a fill; use indodax_paper_fill next.",
    });
  });
  handlers.tools.set("indodax_paper_orders", async () => {
    const orders = app.paper.openOrders();
    return ok({
      count: orders.length,
      orders,
      pairs: [...new Set(orders.map((order) => `${order.symbol.base}_${order.symbol.quote}`))],
      sides: [...new Set(orders.map((order) => order.side))],
      summary: `${orders.length} open paper orders (${orders.filter((o) => o.side === "BUY").length} BUY, ${orders.filter((o) => o.side === "SELL").length} SELL)`,
      note: "ACCEPTED and PARTIALLY_FILLED only. Use indodax_paper_fill or indodax_paper_cancel next.",
    });
  });
  handlers.tools.set("indodax_paper_snapshots", async () => {
    const snapshot = app.paper.snapshot();
    const open = snapshot.orders.filter(
      (order) => order.state === "ACCEPTED" || order.state === "PARTIALLY_FILLED",
    ).length;
    const filled = snapshot.orders.filter((order) => order.state === "FILLED").length;
    return ok({
      ...snapshot,
      summary: {
        assets: Object.keys(snapshot.balances).length,
        totalOrders: snapshot.orders.length,
        openOrders: open,
        filledOrders: filled,
        tradeCount: snapshot.tradeCount,
        totalFees: snapshot.totalFees,
      },
      note: "Full ledger including balances, orders, cost basis, realized PnL, and idempotent replay log.",
    });
  });
  handlers.tools.set("indodax_paper_reset", async (raw) => {
    try {
      const args = parseArgs(paperReset.inputSchema, raw);
      if (args.acknowledged !== true) {
        throw AuthorizationError("paper reset needs acknowledged true");
      }
      const before = app.paper.snapshot();
      const cleared = {
        tradeCount: before.tradeCount,
        openOrders: app.paper.openOrders().length,
        totalFees: before.totalFees,
      };
      app.paper.reset();
      app.audit.record({
        correlationId: `paper-reset-${Date.now().toString(36)}`,
        kind: "PaperReset",
        result: "reset",
        reason: `cleared ${cleared.tradeCount} trades, ${cleared.openOrders} open orders`,
      });
      return ok({ status: "reset", cleared });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_paper_order", async (raw) => {
    try {
      const args = parseArgs(paperOrder.inputSchema, raw);
      return ok(await placePaperOrder(app, args));
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_paper_fill", async (raw) => {
    try {
      const args = parseArgs(paperFill.inputSchema, raw);
      const { fee } = app.paper.fill(args.orderId, String(args.price));
      const snapshot = app.paper.snapshot();
      const filled = snapshot.orders.find(
        (order) =>
          order.internalOrderId === args.orderId ||
          order.exchangeOrderId === args.orderId ||
          order.clientOrderId === args.orderId,
      );
      // OCO completion: a filled take-profit closes the position its sibling
      // stop protects, so a lingering stop would fire later into an empty or
      // reversed position. Bundle TP legs carry `<groupId>-takeProfit` client
      // ids, which is the only link between a paper fill and its stop group.
      // Live fills are not observed server-side, so this runs on paper only.
      const completedStops: string[] = [];
      const filledClientId = filled?.clientOrderId ?? "";
      const suffix = "-takeProfit";
      if (filledClientId.endsWith(suffix)) {
        const groupId = filledClientId.slice(0, -suffix.length);
        if (groupId !== "") {
          for (const sibling of app.stops.list()) {
            if (sibling.groupId === groupId) {
              if (
                app.stops.cancel(sibling.id, `oco-completed by take-profit fill ${filledClientId}`)
              ) {
                completedStops.push(sibling.id);
              }
            }
          }
        }
      }
      return ok({
        orderId: args.orderId,
        status: "filled",
        fee,
        feeRate: "0.0026",
        fillPrice: String(args.price),
        filledQuantity: filled?.quantity ?? null,
        filledOrder: filled ?? null,
        state: filled?.state ?? "FILLED",
        balances: snapshot.balances,
        totalFees: snapshot.totalFees,
        tradeCount: snapshot.tradeCount,
        completedStops,
        summary:
          completedStops.length > 0
            ? `order ${args.orderId} filled at ${String(args.price)} with fee ${fee}; ` +
              `completed OCO stop(s) ${completedStops.join(", ")}`
            : `order ${args.orderId} filled at ${String(args.price)} with fee ${fee}`,
        note: "BUY fills add average-cost basis including fees; SELL fills realize PnL.",
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_paper_cancel", async (raw) => {
    try {
      const args = parseArgs(paperCancel.inputSchema, raw);
      const cancelled = await app.paper.cancel(args.orderId);
      if (!cancelled) throw ValidationError(`paper order ${args.orderId} is not open`);
      const snapshot = app.paper.snapshot();
      return ok({
        orderId: args.orderId,
        status: "cancelled",
        balances: snapshot.balances,
        openOrders: app.paper.openOrders().length,
        tradeCount: snapshot.tradeCount,
        summary: `order ${args.orderId} cancelled with reserved funds refunded`,
        note: "BUY refunds reserved quote; SELL refunds reserved base.",
      });
    } catch (error) {
      return fail(error);
    }
  });
}
