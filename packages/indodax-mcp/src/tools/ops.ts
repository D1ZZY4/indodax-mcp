import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { DEFAULT_PUBLIC_TOKEN, PUBLIC_WS_URL } from "@indodax-mcp/indodax-websocket";
import { maskPrivateChannel } from "@indodax-mcp/indodax-websocket/private-channel";
import { reconcileFills } from "@indodax-mcp/indodax-reconciliation";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import { getBacktest } from "@indodax-mcp/indodax-mcp/tools/ops-backtest";
import { exposureReport } from "@indodax-mcp/indodax-mcp/tools/ops-exposure";

export type { StoredBacktest } from "@indodax-mcp/indodax-mcp/tools/ops-backtest";
export { storeBacktest } from "@indodax-mcp/indodax-mcp/tools/ops-backtest";

const READ = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

/** Socket lifecycle tools mutate connection state without touching exchange data. */
const SOCKET_MUTATION = {
  capability: "SYSTEM" as const,
  riskClass: "mutation" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "mutation" as const,
};

export function registerOpsTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  const backtestGet = defineTool(
    {
      name: "indodax_backtest_get",
      title: "Backtest detail",
      description: "Read-only. One stored backtest report with trade journal. Args: id.",
      ...READ,
    },
    { id: z.string().min(1) },
  );
  const backtestCompare = defineTool(
    {
      name: "indodax_backtest_compare",
      title: "Compare backtests",
      description: "Read-only. Compare net PnL and fills across stored runs. Args: ids array.",
      ...READ,
    },
    { ids: z.array(z.string()).min(2).max(10) },
  );
  const strategyValidate = defineTool(
    {
      name: "indodax_strategy_validate",
      title: "Validate strategy",
      description:
        "No side effects. Check strategy inputs without computing. Args: id, closes, window.",
      ...READ,
    },
    {
      id: z.string().min(1),
      closes: z.array(z.number().positive()),
      window: z.number().int().positive().optional(),
    },
  );
  const reconcileTrades = defineTool(
    {
      name: "indodax_reconcile_trades",
      title: "Reconcile trades",
      description:
        "Read-only. Compare local paper fills against v2 trade history. Needs credentials.",
      ...READ,
      authRequirement: "credentials" as const,
    },
    { symbol: z.string().min(1) },
  );
  const auditRisk = defineTool(
    {
      name: "indodax_audit_risk",
      title: "Risk decisions",
      description: "Read-only. Audit entries for risk approvals and rejections. Args: limit.",
      ...READ,
    },
    { limit: z.number().int().min(1).max(100).optional() },
  );
  const exposure = defineTool(
    {
      name: "indodax_exposure",
      title: "Exposure",
      description: "Read-only. Per-asset paper exposure in IDR at live prices.",
      ...READ,
    },
    {},
  );
  const wsReconnect = defineTool(
    {
      name: "indodax_ws_reconnect",
      title: "Reconnect sockets",
      description:
        "Mutating connection state. Drop and re-establish market and private sockets. Args: scope market, private, or all.",
      ...SOCKET_MUTATION,
    },
    { scope: z.enum(["market", "private", "all"]).optional() },
  );
  const privateConnect = defineTool(
    {
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
    {},
  );
  const privateDisconnect = defineTool(
    {
      name: "indodax_private_disconnect",
      title: "Disconnect private channel",
      description:
        "Mutating connection state. Drop the private order-event channel without touching credentials or tokens. Use after indodax_private_connect when live mirroring is no longer needed.",
      capability: "READ",
      riskClass: "mutation",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    {},
  );
  for (const tool of [
    backtestGet,
    backtestCompare,
    strategyValidate,
    reconcileTrades,
    auditRisk,
    exposure,
    wsReconnect,
    privateConnect,
    privateDisconnect,
  ]) {
    registry.registerTool(tool);
  }

  handlers.tools.set("indodax_backtest_get", async (raw) => {
    try {
      const args = parseArgs(backtestGet.inputSchema, raw);
      const run = getBacktest(args.id);
      if (!run) throw ValidationError(`backtest ${args.id} not found`);
      return ok({
        ...run,
        summary: `backtest ${run.id} with ${run.report.hypotheticalFills} hypothetical fill(s), net PnL ${run.report.netPnl}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_backtest_compare", async (raw) => {
    try {
      const args = parseArgs(backtestCompare.inputSchema, raw);
      const rows = args.ids.map((id) => {
        const run = getBacktest(id);
        if (!run) throw ValidationError(`backtest ${id} not found`);
        return {
          id,
          netPnl: run.report.netPnl,
          fills: run.report.hypotheticalFills,
          fees: run.report.totalFees,
          evaluated: run.report.signalsEvaluated,
        };
      });
      const ranked = [...rows].sort((a, b) =>
        new Decimal(b.netPnl).comparedTo(new Decimal(a.netPnl)),
      );
      return ok({
        count: rows.length,
        rows,
        best: ranked[0]?.id ?? null,
        summary: `best of ${rows.length} is ${ranked[0]?.id ?? "none"} with net PnL ${ranked[0]?.netPnl ?? "n/a"}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_strategy_validate", async (raw) => {
    try {
      const args = parseArgs(strategyValidate.inputSchema, raw);
      if (args.id !== "ma-cross" && args.id !== "momentum-threshold") {
        throw ValidationError("unknown strategy, see indodax_strategies");
      }
      const window = args.window ?? 5;
      const errors: string[] = [];
      if (args.closes.length === 0) {
        errors.push(
          "closes is empty; extract closing prices from indodax_candles bars as " +
            "data[].close (lowercase close, decimal strings)",
        );
      } else if (args.closes.length < 2) {
        errors.push("closes needs at least two numbers");
      }
      if (window > args.closes.length) errors.push("window must fit inside closes");
      return ok({
        id: args.id,
        valid: errors.length === 0,
        errors,
        closes: args.closes.length,
        window,
        summary:
          errors.length === 0
            ? `strategy ${args.id} inputs valid`
            : `invalid: ${errors.join("; ")}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_reconcile_trades", async (raw) => {
    try {
      if (!app.accountClient) throw ValidationError("credentials required");
      const args = parseArgs(reconcileTrades.inputSchema, raw);
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
      const result = reconcileFills(localFills, exchangeFills);
      return ok({
        symbol: args.symbol,
        ...result,
        localCount: localFills.length,
        exchangeCount: exchangeFills.length,
        checkedAt: new Date().toISOString(),
        summary: `${result.state} across ${result.checked} local fill(s) vs ${exchangeFills.length} exchange fill(s)`,
        note: "Paper fills never settle on the exchange; divergence means different ledgers, not broken.",
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_audit_risk", async (raw) => {
    try {
      const args = parseArgs(auditRisk.inputSchema, raw);
      const all = app.audit
        .list()
        .filter((entry) => entry.kind === "RiskApproved" || entry.kind === "RiskRejected");
      const entries = all.slice(-(args.limit ?? 20));
      return ok({
        count: entries.length,
        total: all.length,
        approved: entries.filter((e) => e.kind === "RiskApproved").length,
        rejected: entries.filter((e) => e.kind === "RiskRejected").length,
        entries,
        summary: `${entries.length} risk decision(s) of ${all.length} total`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_exposure", async () => ok(await exposureReport(app)));
  handlers.tools.set("indodax_ws_reconnect", async (raw) => {
    try {
      const args = parseArgs(wsReconnect.inputSchema, raw);
      const scope = args.scope ?? "all";
      const connected: string[] = [];
      const restored: string[] = [];
      const reasons: string[] = [];
      if (scope === "market" || scope === "all") {
        try {
          const subs = await app.marketSocket.reconnectWithResubscribe({
            url: PUBLIC_WS_URL,
            token: app.env.INDODAX_WS_TOKEN ?? DEFAULT_PUBLIC_TOKEN,
          });
          for (const sub of subs) restored.push(sub.channel);
          connected.push("market");
        } catch (error) {
          reasons.push(`market: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (scope === "private" || scope === "all") {
        if (!app.privateTokenFetcher) {
          throw ValidationError("private channel needs API credentials");
        }
        app.privateChannel.disconnect();
        await app.privateChannel.connect(app.privateTokenFetcher);
        connected.push("private");
        restored.push(maskPrivateChannel(app.privateChannel.channel) ?? "private");
      }
      return ok({
        scope,
        reconnected: connected.length > 0,
        connected,
        restored,
        marketState: app.marketSocket.connectionState,
        note:
          restored.length === 0 && connected.length > 0
            ? "connected with no subscriptions to restore; resubscribe first when channel recovery matters"
            : "restored lists resubscribed channels",
        ...(reasons.length > 0 ? { reasons } : {}),
      });
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
        channel: maskPrivateChannel(app.privateChannel.channel),
        state: app.privateChannel.connectionState,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_private_disconnect", async () => {
    app.privateChannel.disconnect();
    return ok({ state: app.privateChannel.connectionState });
  });
}
