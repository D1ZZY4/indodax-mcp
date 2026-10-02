import { z } from "zod";
import { AuthenticationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "../respond.js";
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

const historySchema = z.object({
  symbol: z.string().min(1),
  limit: z.number().int().min(10).max(1000).optional(),
  startTime: z.number().optional(),
  endTime: z.number().optional(),
});

function authed(app: AppServices) {
  if (!app.accountClient) throw AuthenticationError("no API credentials configured");
  return app.accountClient;
}

export function registerHistoryTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_open_orders",
      title: "Open orders",
      description: "Read-only, needs credentials. Live open orders, optional symbol filter.",
      ...READ_AUTH,
    },
    inputSchema: z.object({ symbol: z.string().optional() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_order",
      title: "Order details",
      description:
        "Read-only, needs credentials. One live order by symbol plus orderId or clientOrderId.",
      ...READ_AUTH,
    },
    inputSchema: z.object({
      symbol: z.string().min(1),
      orderId: z.string().optional(),
      clientOrderId: z.string().optional(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_order_history",
      title: "Order history",
      description:
        "Read-only, needs credentials. Order history via v2 (v1 decommissioned). Args: symbol, limit 10-1000, optional time range ms.",
      ...READ_AUTH,
    },
    inputSchema: historySchema,
  });
  registry.registerTool({
    metadata: {
      name: "indodax_trade_history",
      title: "Trade history",
      description:
        "Read-only, needs credentials. Fills via v2 myTrades with fee and tax. Args: symbol, limit 10-1000, optional time range ms.",
      ...READ_AUTH,
    },
    inputSchema: historySchema,
  });
  registry.registerTool({
    metadata: {
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
    inputSchema: z.object({}),
  });

  handlers.tools.set("indodax_open_orders", async (raw) => {
    try {
      const args = parseArgs(z.object({ symbol: z.string().optional() }), raw);
      return ok(await authed(app).openOrders(args.symbol));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_order", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          symbol: z.string().min(1),
          orderId: z.string().optional(),
          clientOrderId: z.string().optional(),
        }),
        raw,
      );
      return ok(await authed(app).getOrder(args.symbol, args.orderId, args.clientOrderId));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_order_history", async (raw) => {
    try {
      const args = parseArgs(historySchema, raw);
      return ok(await authed(app).orderHistories(args));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_trade_history", async (raw) => {
    try {
      const args = parseArgs(historySchema, raw);
      return ok(await authed(app).myTrades(args));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_paper_fills", async () => {
    try {
      const filled = app.paper.snapshot().orders.filter((order) => order.state === "FILLED");
      return ok(filled);
    } catch (error) {
      return fail(error);
    }
  });
}
