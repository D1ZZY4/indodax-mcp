import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { decimalOrNull } from "@indodax-mcp/core";
import { compareBalance } from "@indodax-mcp/indodax-orders";
import { getTicker } from "@indodax-mcp/indodax-market";
import { reconcileAll, reconcileFills } from "@indodax-mcp/indodax-reconciliation";
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

interface PaperConsistency {
  state: "MATCH" | "MISMATCH";
  checkedOrders: number;
  mismatchedOrders: string[];
}

/** Every open paper order must hold valid amounts with remaining in [0, quantity]. */
export function checkPaperConsistency(app: AppServices): PaperConsistency {
  const snapshot = app.paper.snapshot();
  const open = snapshot.orders.filter(
    (order) => order.state === "ACCEPTED" || order.state === "PARTIALLY_FILLED",
  );
  const mismatched: string[] = [];
  for (const order of open) {
    const remaining = decimalOrNull(order.remaining);
    const quantity = decimalOrNull(order.quantity);
    if (remaining === null || quantity === null || remaining.lt(0) || remaining.gt(quantity)) {
      mismatched.push(order.internalOrderId);
    }
  }
  return {
    state: mismatched.length === 0 ? "MATCH" : "MISMATCH",
    checkedOrders: open.length,
    mismatchedOrders: mismatched,
  };
}

const exchangeOrderSchema = z
  .object({
    orderId: z.union([z.string(), z.number()]).optional(),
    fullOrderId: z.string().optional(),
  })
  .passthrough();

const exchangeTradeSchema = z
  .object({
    orderId: z.string().optional(),
    qty: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

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
        "Read-only. Compare paper ledger balances against live account balances within tolerance. Tolerance is a decimal string in quote-asset units, default 0.01. A MISMATCH between paper and exchange ledgers is expected (they never settle); it is observational, not a bug. Needs credentials.",
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
  registry.registerTool({
    metadata: {
      name: "indodax_reconcile_full",
      title: "Full reconciliation",
      description:
        "Read-only, needs credentials. Paper-local consistency plus live exchange open orders, fills, and balances in one report. Paper and exchange are separate ledgers; the cross-scope section is observational and never halts paper trading.",
      ...READ,
      authRequirement: "credentials" as const,
    },
    inputSchema: z.object({
      symbol: z.string().min(1).optional(),
      tolerance: z.string().optional(),
    }),
  });

  handlers.tools.set("indodax_reconcile_balances", async (raw) => {
    try {
      if (!app.accountClient) throw ValidationError("credentials required");
      const args = parseArgs(z.object({ tolerance: z.string().optional() }), raw);
      const tolerance = new Decimal(args.tolerance ?? "0.01");
      const account = await app.accountClient.getAccount();
      app.accountSyncedAt = Date.now();
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
      return ok({
        balances: rows,
        note: "paper and exchange are separate ledgers that never settle; MISMATCH here means different, not broken",
      });
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
      const outcome = checkPaperConsistency(app);
      app.reconciliationHalted = outcome.state === "MISMATCH";
      return ok(outcome);
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_reconcile_full", async (raw) => {
    try {
      if (!app.accountClient) throw ValidationError("credentials required");
      const args = parseArgs(
        z.object({ symbol: z.string().min(1).optional(), tolerance: z.string().optional() }),
        raw,
      );
      const tolerance = new Decimal(args.tolerance ?? "0.01");
      const paper = checkPaperConsistency(app);
      app.reconciliationHalted = paper.state === "MISMATCH";

      const failures: string[] = [];
      let exchangeOrders: { exchangeOrderId: string; state: string }[] = [];
      try {
        const rawOrders = await app.accountClient.openOrders(args.symbol);
        if (!Array.isArray(rawOrders)) throw new Error("unexpected openOrders shape");
        exchangeOrders = rawOrders.map((item, index) => {
          const parsed = exchangeOrderSchema.safeParse(item);
          const id = parsed.success
            ? String(parsed.data.orderId ?? parsed.data.fullOrderId ?? `unknown-${index}`)
            : `unknown-${index}`;
          return { exchangeOrderId: id, state: "OPEN" };
        });
      } catch {
        failures.push("openOrders");
      }

      let exchangeFills: { exchangeOrderId: string; quantity: string }[] = [];
      if (args.symbol !== undefined) {
        try {
          const trades = (await app.accountClient.myTrades({ symbol: args.symbol })) as {
            data?: unknown;
          };
          const list = Array.isArray(trades?.data) ? (trades?.data as unknown[]) : null;
          if (!list) throw new Error("unexpected myTrades shape");
          exchangeFills = list.map((item, index) => {
            const parsed = exchangeTradeSchema.safeParse(item);
            return {
              exchangeOrderId:
                parsed.success && parsed.data.orderId ? parsed.data.orderId : `unknown-${index}`,
              quantity:
                parsed.success && parsed.data.qty !== undefined ? String(parsed.data.qty) : "0",
            };
          });
        } catch {
          failures.push("myTrades");
        }
      }

      const localFills = app.paper
        .snapshot()
        .orders.filter((order) => order.state === "FILLED")
        .map((order) => ({
          exchangeOrderId: order.exchangeOrderId ?? order.internalOrderId,
          quantity: new Decimal(order.quantity).minus(new Decimal(order.remaining)).toString(),
        }));
      const fills = reconcileFills(localFills, exchangeFills);

      let balanceRows: { asset: string; state: string }[] = [];
      try {
        const account = await app.accountClient.getAccount();
        app.accountSyncedAt = Date.now();
        const ledger = app.paper.snapshot();
        balanceRows = account.balances.map((balance) => {
          const asset = balance.asset.toLowerCase();
          return {
            asset,
            state: compareBalance(
              new Decimal(ledger.balances[asset] ?? "0"),
              new Decimal(balance.free).plus(new Decimal(balance.locked)),
              tolerance,
            ),
          };
        });
      } catch {
        failures.push("account");
      }

      const exchangeReport = reconcileAll({
        localOrders: [],
        exchangeOrders,
        localFills: [],
        exchangeFills,
        balances: [],
      });
      return ok({
        paper,
        exchange: {
          openOrders: exchangeOrders,
          fills: { state: fills.state, checked: fills.checked, exchangeOnly: fills.exchangeOnly },
          balances: balanceRows,
          observed: exchangeReport.orders.state,
        },
        unknownLegs: failures,
        crossScopeNote:
          "paper and exchange are separate ledgers; paper fills never settle on exchange",
      });
    } catch (error) {
      return fail(error);
    }
  });
}
