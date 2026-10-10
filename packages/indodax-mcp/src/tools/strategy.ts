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
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { pairArg } from "@indodax-mcp/mcp-app/schemas";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import { storeBacktest } from "@indodax-mcp/mcp-app/tools/ops";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";
import { advise, jevApiKey } from "@indodax-mcp/mcp-app/jev";

const closesArg = z.array(z.number().positive());

/**
 * Direction of the whole sample, independent of the windowed average.
 *
 * Compares last against first with a 0.1% deadband so sideways tapes read
 * flat instead of flickering between up and down on dust.
 */
function sampleTrend(closes: number[]): "up" | "down" | "flat" {
  const first = closes[0];
  const last = closes[closes.length - 1];
  if (first === undefined || last === undefined || first <= 0) return "flat";
  const drift = (last - first) / first;
  if (drift > 0.001) return "up";
  if (drift < -0.001) return "down";
  return "flat";
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

const strategiesList = defineTool(
  {
    name: "indodax_strategies",
    title: "Strategies",
    description:
      "Read-only. The builtin strategy catalog. Strategies emit signals, never orders. Absorbs the former indodax_strategy: pass id to get one strategy instead of the whole list.",
    ...READ,
  },
  { id: z.string().min(1).optional().describe("Return only this strategy") },
);

const strategyEvaluate = defineTool(
  {
    name: "indodax_strategy_evaluate",
    title: "Evaluate signal",
    description:
      "No side effects. Evaluate a moving-average signal over closes, or check the inputs without computing. Absorbs the former indodax_strategy_validate. Args: pair and closes for the signal path, window default 5, and validateOnly to return valid plus errors instead. In validateOnly mode nothing throws: shape problems come back as errors in the result, and id defaults to ma-cross when omitted. Output is a signal, not an order. When OPENCODE_API_KEY is set the response also carries an advisory from the Jev decision model; it is a second opinion on the signal, never a gate, and it does not place or authorise anything.",
    ...READ,
  },
  {
    pair: pairArg.optional().describe("Required unless validateOnly"),
    id: z.string().min(1).optional().describe("Strategy id for the validate path"),
    closes: closesArg,
    window: z.number().int().positive().optional(),
    validateOnly: z.boolean().optional().describe("Check inputs only, return valid and errors"),
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
  registry.registerTool(strategyEvaluate);
  registry.registerTool(backtestRun);

  handlers.tools.set("indodax_strategies", async (raw) => {
    try {
      const args = parseArgs(strategiesList.inputSchema, raw);
      const all = BUILTIN_STRATEGIES.map((s) => ({ ...s, executesOrders: false }));
      if (args.id === undefined) {
        return ok({
          count: all.length,
          strategies: all,
          summary: `${all.length} builtin strategies; all emit signals, never orders`,
        });
      }
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
      const window = args.window ?? 5;
      const id = args.id ?? "ma-cross";
      /**
       * The validate path reports instead of throwing. This is what the former
       * indodax_strategy_validate did, and the difference matters: a caller
       * checking inputs before a scan wants the whole error list in one
       * response, not an exception on the first problem.
       */
      if (args.validateOnly === true) {
        if (id !== "ma-cross" && id !== "momentum-threshold") {
          throw ValidationError("unknown strategy, see indodax_strategies");
        }
        const errors: string[] = [];
        if (args.closes.length === 0) {
          errors.push(
            "closes is empty; extract closing prices from indodax_candles bars as " +
              "data.bars[].close (lowercase close, decimal strings)",
          );
        } else if (args.closes.length < 2) {
          errors.push("closes needs at least two numbers");
        }
        if (window > args.closes.length) errors.push("window must fit inside closes");
        return ok({
          id,
          valid: errors.length === 0,
          errors,
          closes: args.closes.length,
          window,
          summary:
            errors.length === 0 ? `strategy ${id} inputs valid` : `invalid: ${errors.join("; ")}`,
        });
      }
      if (args.pair === undefined) {
        throw ValidationError("pair is required unless validateOnly is true");
      }
      const symbol = parseSymbolFlexible(args.pair);
      if (!symbol) throw ValidationError(`invalid pair: ${args.pair}`);
      const input = { symbol, closes: args.closes, window };
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
          confidence: null,
          trend: null,
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
      /**
       * Optional Jev advisory, annotated onto the same response.
       *
       * Purely additive: the signal above is already computed and returned
       * whatever this produces, and nothing here can gate, alter, or refuse
       * it. Strategies emit signals and never place orders, which is why this
       * read-only evaluation path is an appropriate home for an advisory.
       */
      const review = await advise(
        {
          state: [
            `pair ${signal.symbol.base}_${signal.symbol.quote}`,
            `signal side ${signal.side}`,
            `signal strength ${signal.strength}`,
            `moving-average window ${input.window}`,
            `closes supplied ${args.closes.length}`,
            `sample trend ${sampleTrend(args.closes)}`,
          ].join(". "),
          questions: {
            confidence: {
              type: "noul",
              instructions:
                "Is this trading signal strong and well evidenced enough to deserve a human decision now?",
            },
            classification: {
              type: "choice",
              instructions: "How should an operator treat this signal?",
              criteria: {
                needs_review: "Uncertain or contradictory evidence, warrants human attention",
                routine: "Ordinary signal, fits an existing plan",
              },
            },
            momentum: {
              type: "score",
              instructions: "How persistent is the recent price direction?",
              rubric: ["Fading", "Stable", "Persistent"],
            },
          },
        },
        // The credential is read from the process environment, matching how the
        // rest of the server reads configuration. It is never returned or logged.
        { apiKey: jevApiKey() },
      );
      return ok({
        ...signal,
        pair: `${signal.symbol.base}_${signal.symbol.quote}`,
        verdict: "ok",
        closes: args.closes.length,
        window: input.window,
        /**
         * Confidence weights signal strength by sample adequacy: a drift over
         * barely more closes than the window counts less than the same drift
         * over a long tape. Trend names the sample direction over the full
         * closes (up, down, flat within 0.1%) independent of the windowed
         * average the side comes from.
         */
        confidence: Number(
          (signal.strength * Math.min(1, args.closes.length / (2 * input.window))).toFixed(3),
        ),
        trend: sampleTrend(args.closes),
        summary: `${signal.side} signal with strength ${signal.strength} for ${signal.symbol.base}_${signal.symbol.quote}`,
        advisory: {
          role: "advisory only; it does not gate, alter, or authorise this signal",
          ...review,
        },
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
      // Expectancy is net per hypothetical fill. Win rate is deliberately
      // absent: this replay counts threshold crossings as fills without
      // modeling direction, so every crossing would trivially "win".
      const expectancy =
        report.hypotheticalFills > 0
          ? report.netPnl.div(report.hypotheticalFills).toString()
          : null;
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
        expectancy,
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
