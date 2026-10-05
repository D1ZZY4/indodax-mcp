import { z } from "zod";
import { AuthenticationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "../respond.js";
import { defineTool } from "./define.js";
import type { AppServices } from "../composition.js";

const READ_AUTH = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "credentials" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

const HISTORY_SHAPE = {
  symbol: z.string().min(1),
  limit: z.number().int().min(10).max(1000).optional(),
  startTime: z.number().optional(),
  endTime: z.number().optional(),
};

const openOrders = defineTool(
  {
    name: "indodax_open_orders",
    title: "Open orders",
    description: "Read-only, needs credentials. Live open orders, optional symbol filter.",
    ...READ_AUTH,
  },
  { symbol: z.string().optional() },
);

const orderDetail = defineTool(
  {
    name: "indodax_order",
    title: "Order details",
    description:
      "Read-only, needs credentials. One live order by symbol plus orderId or clientOrderId.",
    ...READ_AUTH,
  },
  {
    symbol: z.string().min(1),
    orderId: z.string().optional(),
    clientOrderId: z.string().optional(),
  },
);

const orderHistory = defineTool(
  {
    name: "indodax_order_history",
    title: "Order history",
    description:
      "Read-only, needs credentials. Order history via v2 (v1 decommissioned). Args: symbol, limit 10-1000, optional time range ms.",
    ...READ_AUTH,
  },
  HISTORY_SHAPE,
);

const tradeHistory = defineTool(
  {
    name: "indodax_trade_history",
    title: "Trade history",
    description:
      "Read-only, needs credentials. Fills via v2 myTrades with fee and tax. Args: symbol, limit 10-1000, optional time range ms.",
    ...READ_AUTH,
  },
  HISTORY_SHAPE,
);

const paperFills = defineTool(
  {
    name: "indodax_paper_fills",
    title: "Paper fills",
    description: "Read-only. Filled paper orders from local simulation.",
    capability: "PAPER",
    riskClass: "read",
    environmentRequirement: "paper",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  {},
);

function authed(app: AppServices) {
  if (!app.accountClient) throw AuthenticationError("no API credentials configured");
  return app.accountClient;
}

export function registerHistoryTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(openOrders);
  registry.registerTool(orderDetail);
  registry.registerTool(orderHistory);
  registry.registerTool(tradeHistory);
  registry.registerTool(paperFills);

  handlers.tools.set("indodax_open_orders", async (raw) => {
    try {
      const args = parseArgs(openOrders.inputSchema, raw);
      const orders = (await authed(app).openOrders(args.symbol)) as unknown[];
      const list = Array.isArray(orders) ? orders : [orders];
      return ok({
        count: list.length,
        symbol: args.symbol ?? "all",
        orders: list,
        summary: `${list.length} live open order(s)${args.symbol ? ` for ${args.symbol}` : ""}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_order", async (raw) => {
    try {
      const args = parseArgs(orderDetail.inputSchema, raw);
      const order = await authed(app).getOrder(args.symbol, args.orderId, args.clientOrderId);
      return ok({
        symbol: args.symbol,
        orderId: args.orderId ?? null,
        clientOrderId: args.clientOrderId ?? null,
        order,
        summary: `live order detail for ${args.symbol}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_order_history", async (raw) => {
    try {
      const args = parseArgs(orderHistory.inputSchema, raw);
      const history = (await authed(app).orderHistories(args)) as { data?: unknown[] };
      const list = Array.isArray(history?.data) ? history.data : history;
      const count = Array.isArray(list) ? list.length : 0;
      return ok({
        symbol: args.symbol,
        limit: args.limit ?? 100,
        count,
        history,
        summary: `${count} order histor(ies) for ${args.symbol}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_trade_history", async (raw) => {
    try {
      const args = parseArgs(tradeHistory.inputSchema, raw);
      const history = (await authed(app).myTrades(args)) as { data?: unknown[] };
      const list = Array.isArray(history?.data) ? history.data : history;
      const count = Array.isArray(list) ? list.length : 0;
      return ok({
        symbol: args.symbol,
        limit: args.limit ?? 100,
        count,
        history,
        summary: `${count} trade(s) for ${args.symbol}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_paper_fills", async () => {
    try {
      const filled = app.paper.snapshot().orders.filter((order) => order.state === "FILLED");
      return ok({
        count: filled.length,
        fills: filled,
        pairs: [...new Set(filled.map((order) => `${order.symbol.base}_${order.symbol.quote}`))],
        summary: `${filled.length} filled paper order(s)`,
        note: "Paper fills never settle on the exchange.",
      });
    } catch (error) {
      return fail(error);
    }
  });
}
