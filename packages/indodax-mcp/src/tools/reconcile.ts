import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker } from "@indodax-mcp/indodax-market";
import { fail, ok, parseArgs } from "../respond.js";
import { checkPaperConsistency } from "../paper-consistency.js";
import { balanceRows, readExchangeLegs } from "./reconcile-exchange.js";
import { defineTool } from "./define.js";
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

interface FillabilityRow {
  orderId: string;
  pair: string;
  state: string;
  side: "BUY" | "SELL";
  limit: string;
  market: string | null;
  fillable: boolean;
  reason: string;
}

/**
 * Fillability of each open paper order against the live market price.
 *
 * An unreadable market keeps the order open and names the pair in `reason`.
 * It is never reported as a definite non-fill, because the price simply was
 * not observed and the order may well be fillable.
 */
async function fillabilityRows(app: AppServices): Promise<FillabilityRow[]> {
  const rows: FillabilityRow[] = [];
  for (const order of app.paper.openOrders()) {
    const pair = `${order.symbol.base}_${order.symbol.quote}`;
    let market: Decimal | null = null;
    let marketReason: string | null = null;
    try {
      const ticker = await getTicker(app.publicClient, pair);
      const parsed = new Decimal(ticker.last);
      market = parsed.isFinite() ? parsed : null;
      if (market === null) marketReason = `ticker last ${ticker.last} is not a number`;
    } catch {
      market = null;
      marketReason = `market unreadable for ${pair}; order kept open, not marked unfillable`;
    }
    const limit = new Decimal(order.price ?? "0");
    const fillable =
      market === null || !limit.isFinite()
        ? false
        : order.side === "BUY"
          ? market.lte(limit)
          : market.gte(limit);
    const reason = !limit.isFinite()
      ? `limit ${order.price ?? "null"} is not a number; fillability unknown`
      : market === null
        ? (marketReason ?? "market unreadable")
        : fillable
          ? order.side === "BUY"
            ? `market ${market.toString()} at or below limit ${limit.toString()}; BUY would fill`
            : `market ${market.toString()} at or above limit ${limit.toString()}; SELL would fill`
          : order.side === "BUY"
            ? `market ${market.toString()} above limit ${limit.toString()}; BUY rests`
            : `market ${market.toString()} below limit ${limit.toString()}; SELL rests`;
    rows.push({
      orderId: order.internalOrderId,
      pair,
      state: order.state,
      side: order.side,
      limit: limit.toString(),
      market: market?.toString() ?? null,
      fillable,
      reason,
    });
  }
  return rows;
}

const reconcileBalances = defineTool(
  {
    name: "indodax_reconcile_balances",
    title: "Reconcile balances",
    description:
      "Read-only. Compare paper ledger balances against live account balances within tolerance. Tolerance is a decimal string in quote-asset units, default 0.01. A MISMATCH between paper and exchange ledgers is expected (they never settle); it is observational, not a bug. Needs credentials.",
    ...READ,
    authRequirement: "credentials",
  },
  { tolerance: z.string().optional() },
);

const reconcileOrders = defineTool(
  {
    name: "indodax_reconcile_orders",
    title: "Reconcile orders",
    description:
      "Read-only. Compare open paper orders against live market prices and flag fillable ones. Every row carries a reason naming the compared values. No mutation.",
    ...READ,
  },
  {},
);

const reconciliationState = defineTool(
  {
    name: "indodax_reconciliation_state",
    title: "Reconciliation state",
    description: "Read-only. Paper ledger internal consistency report.",
    ...READ,
  },
  {},
);

const reconcileFull = defineTool(
  {
    name: "indodax_reconcile_full",
    title: "Full reconciliation",
    description:
      "Read-only, needs credentials. Paper-local consistency plus live exchange open orders, fills, and balances in one report. Paper and exchange are separate ledgers; the cross-scope section is observational and never halts paper trading.",
    ...READ,
    authRequirement: "credentials",
  },
  {
    symbol: z.string().min(1).optional(),
    tolerance: z.string().optional(),
  },
);

export function registerReconcileTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(reconcileBalances);
  registry.registerTool(reconcileOrders);
  registry.registerTool(reconciliationState);
  registry.registerTool(reconcileFull);

  handlers.tools.set("indodax_reconcile_balances", async (raw) => {
    try {
      if (!app.accountClient) throw ValidationError("credentials required");
      const args = parseArgs(reconcileBalances.inputSchema, raw);
      const tolerance = new Decimal(args.tolerance ?? "0.01");
      const account = await app.accountClient.getAccount();
      app.accountSyncedAt = Date.now();
      const paper = app.paper.snapshot();
      return ok({
        balances: balanceRows(paper.balances, account.balances, tolerance),
        note: "paper and exchange are separate ledgers that never settle; MISMATCH here means different, not broken",
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_reconcile_orders", async () => {
    try {
      const rows = await fillabilityRows(app);
      return ok({
        checked: rows.length,
        fillable: rows.filter((row) => row.fillable).length,
        resting: rows.filter((row) => !row.fillable).length,
        orders: rows,
        pairs: [...new Set(rows.map((row) => row.pair))],
        checkedAt: new Date().toISOString(),
        summary:
          rows.length === 0
            ? "no open paper orders to compare against live prices"
            : `${rows.filter((row) => row.fillable).length} fillable of ${rows.length} open order(s) at live prices`,
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_reconciliation_state", async () => {
    try {
      // Pure read: the verdict is reported, never written back into shared
      // application state. Risk re-derives consistency at evaluation time, so
      // calling this tool cannot open or close the trading path.
      const outcome = checkPaperConsistency(app);
      const snapshot = app.paper.snapshot();
      const open = app.paper.openOrders();
      return ok({
        ...outcome,
        openOrders: open.map((order) => ({
          orderId: order.internalOrderId,
          pair: `${order.symbol.base}_${order.symbol.quote}`,
          side: order.side,
          price: order.price,
          quantity: order.quantity,
          remaining: order.remaining,
          state: order.state,
        })),
        totalOrders: snapshot.orders.length,
        filledOrders: snapshot.orders.filter((order) => order.state === "FILLED").length,
        halted: outcome.state === "MISMATCH",
        checkedAt: new Date().toISOString(),
        summary:
          outcome.state === "MISMATCH"
            ? `ledger inconsistency across ${outcome.mismatchedOrders.length} order(s) of ${outcome.checkedOrders} checked; trading halted`
            : `ledger consistent across ${outcome.checkedOrders} open order(s); trading open`,
        note: "Paper-local consistency only. Cross-ledger paper-vs-exchange comparison lives in indodax_reconcile_full.",
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_reconcile_full", async (raw) => {
    try {
      if (!app.accountClient) throw ValidationError("credentials required");
      const args = parseArgs(reconcileFull.inputSchema, raw);
      const tolerance = new Decimal(args.tolerance ?? "0.01");
      const paper = checkPaperConsistency(app);
      const exchange = await readExchangeLegs(app, args.symbol, tolerance);
      return ok({
        paper,
        exchange,
        unknownLegs: exchange.unknownLegs.map((issue) => issue.leg),
        unknownLegDetail: exchange.unknownLegs,
        crossScopeNote:
          "paper and exchange are separate ledgers; paper fills never settle on exchange",
      });
    } catch (error) {
      return fail(error);
    }
  });
}
