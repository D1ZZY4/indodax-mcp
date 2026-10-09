import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker } from "@indodax-mcp/indodax-market";
import { reconcileFills } from "@indodax-mcp/indodax-reconciliation";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { checkPaperConsistency } from "@indodax-mcp/mcp-app/paper-consistency";
import {
  balanceRows,
  localPaperFills,
  readExchangeLegs,
} from "@indodax-mcp/mcp-app/tools/reconcile-exchange";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

const PAPER = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

const EXCHANGE = { ...PAPER, authRequirement: "credentials" as const };

/**
 * Five reconciliation reads become two, split on a real boundary.
 *
 * The paper-local checks (`state`, `orders`) run entirely on the in-memory
 * ledger and must keep working without credentials. The exchange-backed ones
 * (`balances`, `trades`, `full`) all need the authenticated client. Merging
 * them into one tool would force a single `authRequirement`, which either
 * denies the paper paths for an uncredentialed server or stops declaring
 * `credentials` and pushes the gate out of the central guard into the handler.
 * Neither is worth one slot of context, so the split is kept and each side
 * takes a `scope`.
 */
const reconcilePaper = defineTool(
  {
    name: "indodax_reconcile_paper",
    title: "Reconcile paper ledger",
    description:
      "Read-only, no credentials needed. Paper-local checks against the in-memory ledger. Absorbs the former indodax_reconciliation_state and indodax_reconcile_orders. Args: scope state reports ledger consistency and whether it halted trading; scope orders reports whether each open order is fillable at the live market with the compared values in reason. A read here never mutates application state: the risk engine re-derives consistency on every evaluation, so calling this cannot open or close the trading path.",
    ...PAPER,
  },
  { scope: z.enum(["state", "orders"]).describe("Which paper-local check to run") },
);

const reconcileExchange = defineTool(
  {
    name: "indodax_reconcile_exchange",
    title: "Reconcile against the exchange",
    description:
      "Read-only, needs credentials. Cross-ledger checks against live exchange reads. Absorbs the former indodax_reconcile_balances, indodax_reconcile_trades, and indodax_reconcile_full. Args: scope balances compares paper against account balances within tolerance, trades compares local paper fills against v2 myTrades for one symbol, full returns paper-local consistency plus live open orders, fills, and balances. tolerance is a decimal string in quote-asset units, default 0.01. Paper and exchange are separate ledgers that never settle, so a MISMATCH here means different, not broken. Read-only: the cross-ledger comparison never halts paper trading.",
    ...EXCHANGE,
  },
  {
    scope: z.enum(["balances", "trades", "full"]).describe("Which exchange check to run"),
    symbol: z.string().min(1).optional().describe("Required for scope trades, optional for full"),
    tolerance: z.string().optional().describe("Decimal string in quote-asset units"),
  },
);

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
 * An unreadable market keeps the order open and names the pair in `reason`. It
 * is never reported as a definite non-fill, because the price simply was not
 * observed and the order may well be fillable.
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

export function registerReconcileTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(reconcilePaper);
  registry.registerTool(reconcileExchange);

  handlers.tools.set("indodax_reconcile_paper", async (raw) => {
    try {
      const args = parseArgs(reconcilePaper.inputSchema, raw);
      if (args.scope === "orders") {
        const rows = await fillabilityRows(app);
        return ok({
          scope: "orders",
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
      }
      // Pure read: the verdict is reported, never written back into shared
      // application state. Risk re-derives consistency at evaluation time, so
      // calling this cannot open or close the trading path.
      const outcome = checkPaperConsistency(app);
      const snapshot = app.paper.snapshot();
      const open = app.paper.openOrders();
      return ok({
        scope: "state",
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
        note: "Paper-local consistency only. Cross-ledger comparison lives in indodax_reconcile_exchange.",
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_reconcile_exchange", async (raw) => {
    try {
      const args = parseArgs(reconcileExchange.inputSchema, raw);
      if (!app.accountClient) throw ValidationError("credentials required");
      const tolerance = new Decimal(args.tolerance ?? "0.01");
      if (args.scope === "balances") {
        const account = await app.accountClient.getAccount();
        app.accountSyncedAt = Date.now();
        const paper = app.paper.snapshot();
        return ok({
          scope: "balances",
          balances: balanceRows(paper.balances, account.balances, tolerance),
          note: "paper and exchange are separate ledgers that never settle; MISMATCH here means different, not broken",
        });
      }
      if (args.scope === "trades") {
        const symbol = args.symbol;
        if (symbol === undefined) {
          throw ValidationError("scope trades requires symbol");
        }
        const exchange = (await app.accountClient.myTrades({ symbol })) as {
          data?: { orderId?: string; qty?: string }[];
        };
        const exchangeFills = (exchange.data ?? [])
          .filter((trade) => typeof trade.orderId === "string")
          .map((trade) => ({
            exchangeOrderId: trade.orderId as string,
            quantity: trade.qty ?? "0",
          }));
        const local = localPaperFills(app);
        const result = reconcileFills(local, exchangeFills);
        return ok({
          scope: "trades",
          symbol,
          ...result,
          localCount: local.length,
          exchangeCount: exchangeFills.length,
          checkedAt: new Date().toISOString(),
          summary: `${result.state} across ${result.checked} local fill(s) vs ${exchangeFills.length} exchange fill(s)`,
          note: "Paper fills never settle on the exchange; divergence means different ledgers, not broken.",
        });
      }
      const paper = checkPaperConsistency(app);
      const exchange = await readExchangeLegs(app, args.symbol, tolerance);
      return ok({
        scope: "full",
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
