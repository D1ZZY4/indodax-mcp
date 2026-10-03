import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker } from "@indodax-mcp/indodax-market";
import { reconcileFills } from "@indodax-mcp/indodax-reconciliation";
import type { BacktestReport } from "@indodax-mcp/indodax-backtest";
import { fail, ok, parseArgs } from "../respond.js";
import type { AppServices } from "../composition.js";

interface StoredBacktest {
  id: string;
  report: {
    signalsEvaluated: number;
    hypotheticalFills: number;
    totalFees: string;
    netPnl: string;
    maxDrawdownPct: string;
    trades: { index: number; price: string; fee: string }[];
  };
  createdAt: string;
}

const runs = new Map<string, StoredBacktest>();
let runCounter = 1;

/** Bounded so long-running processes cannot leak memory. Oldest run evicted first. */
const MAX_STORED_RUNS = 100;

export function storeBacktest(report: BacktestReport): StoredBacktest {
  const id = `backtest-${runCounter}`;
  runCounter += 1;
  const stored: StoredBacktest = {
    id,
    report: {
      signalsEvaluated: report.signalsEvaluated,
      hypotheticalFills: report.hypotheticalFills,
      totalFees: report.totalFees.toString(),
      netPnl: report.netPnl.toString(),
      maxDrawdownPct: report.maxDrawdownPct.toString(),
      trades: report.trades.map((trade) => ({
        index: trade.index,
        price: trade.price.toString(),
        fee: trade.fee.toString(),
      })),
    },
    createdAt: new Date().toISOString(),
  };
  runs.set(id, stored);
  while (runs.size > MAX_STORED_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }
  return stored;
}

const READ = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

export function registerOpsTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_backtest_get",
      title: "Backtest detail",
      description: "Read-only. One stored backtest report with trade journal. Args: id.",
      ...READ,
    },
    inputSchema: z.object({ id: z.string().min(1) }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_backtest_compare",
      title: "Compare backtests",
      description: "Read-only. Compare net PnL and fills across stored runs. Args: ids array.",
      ...READ,
    },
    inputSchema: z.object({ ids: z.array(z.string()).min(2).max(10) }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_strategy_validate",
      title: "Validate strategy",
      description:
        "No side effects. Check strategy inputs without computing. Args: id, closes, window.",
      ...READ,
    },
    inputSchema: z.object({
      id: z.string().min(1),
      closes: z.array(z.number().positive()),
      window: z.number().int().positive().optional(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_reconcile_trades",
      title: "Reconcile trades",
      description:
        "Read-only. Compare local paper fills against v2 trade history. Needs credentials.",
      ...READ,
      authRequirement: "credentials" as const,
    },
    inputSchema: z.object({ symbol: z.string().min(1) }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_audit_risk",
      title: "Risk decisions",
      description: "Read-only. Audit entries for risk approvals and rejections. Args: limit.",
      ...READ,
    },
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_exposure",
      title: "Exposure",
      description: "Read-only. Per-asset paper exposure in IDR at live prices.",
      ...READ,
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_ws_reconnect",
      title: "Reconnect sockets",
      description:
        "Mutating connection state. Drop and re-establish market and private sockets. Args: scope market, private, or all.",
      capability: "SYSTEM",
      riskClass: "mutation",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({ scope: z.enum(["market", "private", "all"]).optional() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_private_connect",
      title: "Connect private channel",
      description:
        "Mutating connection state, needs credentials. Fetch a private token and subscribe to the private order-event channel. Returns the channel and connection state, never the token.",
      capability: "READ",
      riskClass: "mutation",
      environmentRequirement: "any",
      authRequirement: "credentials",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_arm",
      title: "Arm Deadman",
      description:
        "Mutating safety state. Arm the Deadman countdown for pairs. Paper only simulates. Args: pairs, countdownMs.",
      capability: "TRADE",
      riskClass: "mutation",
      environmentRequirement: "paper",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({
      pairs: z.array(z.string().min(1)).min(1),
      countdownMs: z.number().positive(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_status",
      title: "Deadman status",
      description: "Read-only. Deadman state, pairs, and failure count.",
      ...READ,
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_disarm",
      title: "Disarm Deadman",
      description: "Mutating safety state. Disarm the Deadman countdown.",
      capability: "TRADE",
      riskClass: "mutation",
      environmentRequirement: "paper",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({}),
  });

  handlers.tools.set("indodax_backtest_get", async (raw) => {
    try {
      const args = parseArgs(z.object({ id: z.string().min(1) }), raw);
      const run = runs.get(args.id);
      if (!run) throw ValidationError(`backtest ${args.id} not found`);
      return ok(run);
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_backtest_compare", async (raw) => {
    try {
      const args = parseArgs(z.object({ ids: z.array(z.string()).min(2).max(10) }), raw);
      const rows = args.ids.map((id) => {
        const run = runs.get(id);
        if (!run) throw ValidationError(`backtest ${id} not found`);
        return { id, netPnl: run.report.netPnl, fills: run.report.hypotheticalFills };
      });
      const ranked = [...rows].sort((a, b) =>
        new Decimal(b.netPnl).comparedTo(new Decimal(a.netPnl)),
      );
      return ok({ rows, best: ranked[0]?.id ?? null });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_strategy_validate", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          id: z.string().min(1),
          closes: z.array(z.number().positive()),
          window: z.number().int().positive().optional(),
        }),
        raw,
      );
      if (args.id !== "ma-cross" && args.id !== "momentum-threshold") {
        throw ValidationError("unknown strategy, see indodax_strategies");
      }
      const window = args.window ?? 5;
      const errors: string[] = [];
      if (args.closes.length < 2) errors.push("closes needs at least two numbers");
      if (window > args.closes.length) errors.push("window must fit inside closes");
      return ok({ id: args.id, valid: errors.length === 0, errors });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_reconcile_trades", async (raw) => {
    try {
      if (!app.accountClient) throw ValidationError("credentials required");
      const args = parseArgs(z.object({ symbol: z.string().min(1) }), raw);
      const exchange = (await app.accountClient.myTrades({ symbol: args.symbol })) as {
        data?: { orderId?: string; qty?: string }[];
      };
      const exchangeFills = (exchange.data ?? [])
        .filter((trade) => typeof trade.orderId === "string")
        .map((trade) => ({
          exchangeOrderId: trade.orderId as string,
          quantity: trade.qty ?? "0",
        }));
      const localFills = app.paper
        .snapshot()
        .orders.filter((order) => order.state === "FILLED")
        .map((order) => ({
          exchangeOrderId: order.exchangeOrderId ?? order.internalOrderId,
          quantity: new Decimal(order.quantity).minus(new Decimal(order.remaining)).toString(),
        }));
      return ok({ symbol: args.symbol, ...reconcileFills(localFills, exchangeFills) });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_audit_risk", async (raw) => {
    try {
      const args = parseArgs(z.object({ limit: z.number().int().min(1).max(100).optional() }), raw);
      const entries = app.audit
        .list()
        .filter((entry) => entry.kind === "RiskApproved" || entry.kind === "RiskRejected")
        .slice(-(args.limit ?? 20));
      return ok(entries);
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_exposure", async () => {
    try {
      const balances = app.paper.snapshot().balances;
      const rows = [];
      for (const [asset, amount] of Object.entries(balances)) {
        if (asset === "idr") {
          rows.push({ asset, amount, valueIdr: amount });
          continue;
        }
        try {
          const ticker = await getTicker(app.publicClient, `${asset}_idr`);
          rows.push({
            asset,
            amount,
            valueIdr: new Decimal(amount).mul(new Decimal(ticker.last)).toString(),
          });
        } catch {
          rows.push({ asset, amount, valueIdr: null });
        }
      }
      return ok({ exposure: rows });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_ws_reconnect", async (raw) => {
    try {
      const args = parseArgs(
        z.object({ scope: z.enum(["market", "private", "all"]).optional() }),
        raw,
      );
      const scope = args.scope ?? "all";
      if (scope === "market" || scope === "all") {
        app.marketSocket.disconnect();
        for (const sub of app.marketSocket.listSubscriptions()) {
          app.marketSocket.subscribe(sub.channel);
        }
      }
      if (scope === "private" || scope === "all") {
        if (!app.privateTokenFetcher) {
          throw ValidationError("private channel needs API credentials");
        }
        app.privateChannel.disconnect();
        await app.privateChannel.connect(app.privateTokenFetcher);
      }
      return ok({ scope, reconnected: true });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_private_connect", async () => {
    try {
      if (!app.privateTokenFetcher) {
        throw ValidationError("private channel needs API credentials");
      }
      await app.privateChannel.connect(app.privateTokenFetcher);
      return ok({
        channel: app.privateChannel.channel,
        state: app.privateChannel.connectionState,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deadman_arm", async (raw) => {
    try {
      const args = parseArgs(
        z.object({ pairs: z.array(z.string().min(1)).min(1), countdownMs: z.number().positive() }),
        raw,
      );
      return ok(app.deadman.arm(args.pairs, args.countdownMs));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deadman_status", async () => ok(app.deadman.snapshot()));
  handlers.tools.set("indodax_deadman_disarm", async () => ok(app.deadman.disarm()));
}
