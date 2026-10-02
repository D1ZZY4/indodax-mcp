import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { compareBalance, compareOrderIds } from "@indodax-mcp/indodax-orders";
import { getTicker } from "@indodax-mcp/indodax-market";
import { fail, ok, parseArgs } from "../respond.js";
import type { AppServices } from "../composition.js";

const READ = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

export function registerReconcileTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_reconcile_balances",
      title: "Reconcile balances",
      description:
        "Read-only. Compare paper ledger balances against live account balances within tolerance. Needs credentials.",
      ...READ,
      authRequirement: "credentials" as const,
    },
    inputSchema: z.object({ tolerance: z.string().optional() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_reconcile_orders",
      title: "Reconcile orders",
      description:
        "Read-only. Compare open paper orders against live market prices and flag fillable ones. No mutation.",
      ...READ,
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_reconciliation_state",
      title: "Reconciliation state",
      description: "Read-only. Paper ledger internal consistency report.",
      ...READ,
    },
    inputSchema: z.object({}),
  });

  handlers.tools.set("indodax_reconcile_balances", async (raw) => {
    try {
      if (!app.accountClient) throw ValidationError("credentials required");
      const args = parseArgs(z.object({ tolerance: z.string().optional() }), raw);
      const tolerance = new Decimal(args.tolerance ?? "0.01");
      const account = await app.accountClient.getAccount();
      const paper = app.paper.snapshot();
      const rows = [];
      for (const balance of account.balances) {
        const asset = balance.asset.toLowerCase();
        const state = compareBalance(
          new Decimal(paper.balances[asset] ?? "0"),
          new Decimal(balance.free).plus(new Decimal(balance.locked)),
          tolerance,
        );
        rows.push({ asset, state });
      }
      return ok({ balances: rows });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_reconcile_orders", async () => {
    try {
      const rows = [];
      for (const order of app.paper.openOrders()) {
        let market: Decimal | null = null;
        try {
          const ticker = await getTicker(
            app.publicClient,
            `${order.symbol.base}_${order.symbol.quote}`,
          );
          const parsed = new Decimal(ticker.last);
          market = parsed.isFinite() ? parsed : null;
        } catch {
          market = null;
        }
        const limit = new Decimal(order.price ?? "0");
        rows.push({
          orderId: order.internalOrderId,
          state: order.state,
          limit: limit.toString(),
          market: market?.toString() ?? null,
          fillable:
            market === null || !limit.isFinite()
              ? false
              : order.side === "BUY"
                ? market.lte(limit)
                : market.gte(limit),
        });
      }
      return ok({ checked: rows.length, orders: rows });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_reconciliation_state", async () => {
    try {
      const snapshot = app.paper.snapshot();
      const local = snapshot.orders
        .filter((order) => order.state === "ACCEPTED")
        .map((order) => order.exchangeOrderId ?? order.internalOrderId);
      const outcome = compareOrderIds(local, local);
      return ok({ state: outcome.state, checkedOrders: outcome.checkedOrders });
    } catch (error) {
      return fail(error);
    }
  });
}
