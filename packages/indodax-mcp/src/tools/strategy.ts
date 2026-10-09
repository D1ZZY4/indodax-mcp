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
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { pairArg } from "@indodax-mcp/indodax-mcp/schemas";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import { storeBacktest } from "@indodax-mcp/indodax-mcp/tools/ops";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

const closesArg = z.array(z.number().positive());

const READ = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

const strategiesList = defineTool(
  {
    name: "indodax_strategies",
    title: "Strategies",
    description: "Read-only. List builtin strategies. Strategies emit signals, never orders.",
    ...READ,
  },
  {},
);

const strategyDetail = defineTool(
  {
    name: "indodax_strategy",
    title: "Strategy detail",
    description: "Read-only. Describe one builtin strategy by id. Args: id.",
    ...READ,
  },
  { id: z.string().min(1) },
);

const strategyEvaluate = defineTool(
  {
    name: "indodax_strategy_evaluate",
    title: "Evaluate signal",
    description:
      "No side effects. Evaluate a moving-average signal over closes. Output is a signal, not an order.",
    ...READ,
  },
  {
    pair: pairArg,
    closes: closesArg,
    window: z.number().int().positive().optional(),
  },
);

const backtestRun = defineTool(
  {
    name: "indodax_backtest_run",
    title: "Run backtest",
    description:
      "No side effects. Replay closes with threshold crossings as hypothetical fills. Threshold is a fraction: 0.05 means a 5% move between closes. Separate from paper trading. Never uses real money.",
    ...READ,
  },
  {
    closes: closesArg,
    threshold: z.number().positive().optional(),
    feeRate: z.number().nonnegative().optional(),
    notional: z.number().positive().optional(),
  },
);

export function registerStrategyTools(
  registry: Registry,
  handlers: ServerHandlers,
  _app: AppServices,
): void {
  void _app;
  registry.registerTool(strategiesList);
  registry.registerTool(strategyDetail);
  registry.registerTool(strategyEvaluate);
  registry.registerTool(backtestRun);

  handlers.tools.set("indodax_strategies", async () =>
    ok({
      count: BUILTIN_STRATEGIES.length,
      strategies: BUILTIN_STRATEGIES.map((s) => ({ ...s, executesOrders: false })),
      summary: `${BUILTIN_STRATEGIES.length} builtin strategies; all emit signals, never orders`,
    }),
  );
  handlers.tools.set("indodax_strategy", async (raw) => {
    try {
      const args = parseArgs(strategyDetail.inputSchema, raw);
      const strategy = BUILTIN_STRATEGIES.find((item) => item.id === args.id);
      if (!strategy) throw ValidationError("unknown strategy, see indodax_strategies");
      return ok({
        ...strategy,
        executesOrders: false,
        summary: `strategy ${strategy.id}: ${strategy.description}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_strategy_evaluate", async (raw) => {
    try {
      const args = parseArgs(strategyEvaluate.inputSchema, raw);
      const symbol = parseSymbolFlexible(args.pair);
      if (!symbol) throw ValidationError(`invalid pair: ${args.pair}`);
      const input = { symbol, closes: args.closes, window: args.window ?? 5 };
      const errors = validateSignalInput(input);
      // Shape faults (too few closes, non-positive prices) stay validation
      // errors. A window wider than the available history is separated out,
      // because that is a thin market rather than a bad request, and a
      // screener needs it reported without an exception.
      const shapeErrors = errors.filter((error) => error !== "window must fit inside closes");
      if (shapeErrors.length > 0) throw ValidationError(shapeErrors.join("; "));
      const signal = errors.length > 0 ? null : evaluateMovingAverage(input);
      // A thin pair is a normal screener outcome, not a caller mistake. Report
      // it in the success envelope with an explicit verdict so a scan over many
      // pairs does not have to catch an error to learn the symbol has no signal
      // yet, and never has to invent a strength of 0 for an absent signal.
      if (!signal) {
        return ok({
          pair: `${symbol.base}_${symbol.quote}`,
          symbol,
          side: null,
          strength: null,
          reason: "not enough closes to evaluate this window",
          verdict: "insufficient_data",
          closes: args.closes.length,
          window: input.window,
          closesNeeded: input.window,
          note:
            `only ${args.closes.length} close(s) supplied but window ${input.window} needs at least ` +
            `${input.window}; supply more closes with indodax_candles or lower window, and do not read ` +
            "this as a neutral signal",
          summary: `no signal for ${symbol.base}_${symbol.quote}: needs ${input.window} closes, got ${args.closes.length}`,
        });
      }
      return ok({
        ...signal,
        pair: `${signal.symbol.base}_${signal.symbol.quote}`,
        verdict: "ok",
        closes: args.closes.length,
        window: input.window,
        summary: `${signal.side} signal with strength ${signal.strength} for ${signal.symbol.base}_${signal.symbol.quote}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_backtest_run", async (raw) => {
    try {
      const args = parseArgs(backtestRun.inputSchema, raw);
      if (args.closes.length === 0) {
        throw ValidationError(
          "closes is empty; extract closing prices from indodax_candles bars as " +
            "data.bars[].close (lowercase close, decimal strings)",
        );
      }
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
