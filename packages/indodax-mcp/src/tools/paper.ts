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

/**
 * The whole ledger, in four views.
 *
 * `indodax_paper_snapshots` already returned the complete ledger object plus
 * counts, and the other three read tools were strict subsets of it: account and
 * status were field selections over the same snapshot, and orders was
 * `openOrders()` over the same order array. One tool with a `view` argument
 * replaces all four without dropping a field.
 */
const paperLedger = defineTool(
  {
    name: "indodax_paper_ledger",
    title: "Paper ledger",
    description:
      "Read-only. The complete virtual paper ledger, never real money. Absorbs the former indodax_paper_status, indodax_paper_account, indodax_paper_orders, and indodax_paper_snapshots. Args: view selects the shape. status (default) gives trade count, open orders with ids, fees, filled count, balances, and realized PnL today. account adds initial balances and the tracked cost-basis assets. orders lists the full open order records with pairs and sides. snapshots returns the raw ledger plus summary counts. Every view also returns the raw data under ledger, so no view has to be guessed to find a field.",
    ...PAPER_READ,
  },
  {
    view: z
      .enum(["status", "account", "orders", "snapshots"])
      .optional()
      .describe("Which shape to return; status is the default"),
  },
);

export function registerPaperTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(paperLedger);
  registry.registerTool(paperOrder);
  registry.registerTool(paperFill);
  registry.registerTool(paperCancel);
  registry.registerTool(paperReset);

  handlers.tools.set("indodax_paper_ledger", async (raw) => {
    try {
      const args = parseArgs(paperLedger.inputSchema, raw);
      const view = args.view ?? "status";
      const snapshot = app.paper.snapshot();
      const open = app.paper.openOrders();
      const openOrderIds = open.map((order) => order.internalOrderId);
      const filled = snapshot.orders.filter((order) => order.state === "FILLED").length;
      const base = {
        view,
        tradeCount: snapshot.tradeCount,
        openOrders: open.length,
        openOrderIds: openOrderIds.slice(0, 100),
        openOrdersTruncated: openOrderIds.length > 100,
        filledOrders: filled,
        totalFees: snapshot.totalFees,
        balances: snapshot.balances,
        realizedByDay: snapshot.realizedByDay,
        pairs: [...new Set(open.map((order) => `${order.symbol.base}_${order.symbol.quote}`))],
        // The raw ledger always rides along. The named fields above are the
        // convenient view; this is the same data they were selected from, so a
        // caller never has to switch view to reach a field it needs.
        ledger: snapshot,
      };
      if (view === "snapshots") {
        return ok({
          ...base,
          summary: {
            assets: Object.keys(snapshot.balances).length,
            totalOrders: snapshot.orders.length,
            openOrders: open.length,
            filledOrders: filled,
            tradeCount: snapshot.tradeCount,
            totalFees: snapshot.totalFees,
          },
          note: "Raw ledger including balances, orders, cost basis, realized PnL, and the idempotent replay log.",
        });
      }
      if (view === "orders") {
        return ok({
          ...base,
          count: open.length,
          orders: open,
          sides: [...new Set(open.map((order) => order.side))],
          summary: `${open.length} open paper orders (${open.filter((o) => o.side === "BUY").length} BUY, ${open.filter((o) => o.side === "SELL").length} SELL)`,
          note: "ACCEPTED and PARTIALLY_FILLED only. Use indodax_paper_fill or indodax_paper_cancel next.",
        });
      }
      if (view === "account") {
        return ok({
          ...base,
          initialBalances: snapshot.initialBalances,
          costBasisAssets: Object.keys(snapshot.costBasis),
          summary: `${Object.keys(snapshot.balances).length} assets, ${open.length} open orders, ${snapshot.tradeCount} lifetime trades, fees ${snapshot.totalFees}`,
          note: "Simulation only. Paper balances never settle on the exchange.",
        });
      }
      return ok({
        ...base,
        initialBalances: snapshot.initialBalances,
        summary: `trades=${snapshot.tradeCount} open=${open.length} filled=${filled} fees=${snapshot.totalFees}`,
        note: "Simulation only. Acceptance is not a fill; use indodax_paper_fill next.",
      });
    } catch (error) {
      return fail(error);
    }
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
