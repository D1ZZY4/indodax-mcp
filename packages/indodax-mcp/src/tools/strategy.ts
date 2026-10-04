import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { parseSymbolFlexible } from "@indodax-mcp/core";
import {
  BUILTIN_STRATEGIES,
  evaluateMovingAverage,
  validateSignalInput,
} from "@indodax-mcp/indodax-strategy";
import { runBacktest } from "@indodax-mcp/indodax-backtest";
import { fail, ok, parseArgs } from "../respond.js";
import { pairArg } from "../schemas.js";
import { storeBacktest } from "./ops.js";
import type { AppServices } from "../composition.js";

const closesArg = z.array(z.number().positive());

export function registerStrategyTools(
  registry: Registry,
  handlers: ServerHandlers,
  _app: AppServices,
): void {
  void _app;
  registry.registerTool({
    metadata: {
      name: "indodax_strategies",
      title: "Strategies",
      description: "Read-only. List builtin strategies. Strategies emit signals, never orders.",
      capability: "READ",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_strategy",
      title: "Strategy detail",
      description: "Read-only. Describe one builtin strategy by id. Args: id.",
      capability: "READ",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({ id: z.string().min(1) }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_strategy_evaluate",
      title: "Evaluate signal",
      description:
        "No side effects. Evaluate a moving-average signal over closes. Output is a signal, not an order.",
      capability: "READ",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({
      pair: pairArg,
      closes: closesArg,
      window: z.number().int().positive().optional(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_backtest_run",
      title: "Run backtest",
      description:
        "No side effects. Replay closes with threshold crossings as hypothetical fills. Threshold is a fraction: 0.05 means a 5% move between closes. Separate from paper trading. Never uses real money.",
      capability: "READ",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({
      closes: closesArg,
      threshold: z.number().positive().optional(),
      feeRate: z.number().nonnegative().optional(),
      notional: z.number().positive().optional(),
    }),
  });

  handlers.tools.set("indodax_strategies", async () => ok(BUILTIN_STRATEGIES));
  handlers.tools.set("indodax_strategy", async (raw) => {
    try {
      const args = parseArgs(z.object({ id: z.string().min(1) }), raw);
      const strategy = BUILTIN_STRATEGIES.find((item) => item.id === args.id);
      if (!strategy) throw ValidationError("unknown strategy, see indodax_strategies");
      return ok({ ...strategy, executesOrders: false });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_strategy_evaluate", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          pair: pairArg,
          closes: closesArg,
          window: z.number().int().positive().optional(),
        }),
        raw,
      );
      const symbol = parseSymbolFlexible(args.pair);
      if (!symbol) throw ValidationError(`invalid pair: ${args.pair}`);
      const input = { symbol, closes: args.closes, window: args.window ?? 5 };
      const errors = validateSignalInput(input);
      if (errors.length > 0) throw ValidationError(errors.join("; "));
      const signal = evaluateMovingAverage(input);
      if (!signal) throw ValidationError("need at least window closes");
      return ok(signal);
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_backtest_run", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          closes: closesArg,
          threshold: z.number().positive().optional(),
          feeRate: z.number().nonnegative().optional(),
          notional: z.number().positive().optional(),
        }),
        raw,
      );
      if (args.closes.length < 2) throw ValidationError("need at least two closes");
      const feeRate = new Decimal(String(args.feeRate ?? 0.0026));
      const threshold = new Decimal(String(args.threshold ?? 0.05));
      const notional = new Decimal(String(args.notional ?? 1000));
      const report = runBacktest(
        args.closes.map((close) => new Decimal(String(close))),
        { feeRate, threshold, notional },
      );
      const stored = storeBacktest(report);
      return ok({
        id: stored.id,
        note: "hypothetical replay with assumed fees and no slippage; not evidence of real profit",
        inputs: {
          feeRate: feeRate.toString(),
          threshold: threshold.toString(),
          notional: notional.toString(),
        },
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
      });
    } catch (error) {
      return fail(error);
    }
  });
}
