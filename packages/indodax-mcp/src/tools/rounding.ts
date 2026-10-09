import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import { getPairsCached, clearCache } from "@indodax-mcp/indodax-market";
import type { PairInfo } from "@indodax-mcp/indodax-client";
import { parseSymbolFlexible, asPair, decimalOrNull } from "@indodax-mcp/core";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import { roundOrder, roundingContextFor } from "@indodax-mcp/mcp-app/order-rounding";
import { assessBudgetSize, assessStopRisk } from "@indodax-mcp/mcp-app/risk-budget";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

/**
 * Rounding preflight.
 *
 * Precision rejection is the most common reason a correct-looking order fails.
 * This answers "what would the exchange accept" without placing anything, so a
 * caller can size an order once instead of discovering the increment by being
 * rejected. The same helper runs before real placement.
 */

const ROUND = defineTool(
  {
    name: "indodax_round_order",
    title: "Round order",
    description:
      "Read-only, places nothing. Round a quantity and price to what one pair actually accepts, using the live pair list. Args: pair required, side only for context, quantity required in base units, optional price, optional riskBudget in quote units plus optional stopPrice for a notional multiple and a real stop-distance assessment. Reports the rounded values, the originals, whether anything changed, and any rule that blocked the order with the real numbers, such as an increment that leaves nothing tradable or a notional under the pair minimum. Money as strings.",
    capability: "READ",
    riskClass: "read",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  {
    pair: z.string().min(1),
    side: z.enum(["BUY", "SELL"]).optional(),
    quantity: z.number().positive(),
    price: z.number().positive().optional(),
    riskBudget: z.number().positive().optional(),
    stopPrice: z.number().positive().optional(),
  },
);

const SUGGEST = defineTool(
  {
    name: "indodax_suggest_stop",
    title: "Suggest stop",
    description:
      "Read-only, places nothing. Price a percent-distance stop for a planned position against both notional floors before committing: returns the trigger price, the stop notional, whether it clears the pair and application minimums, the minimum viable quantity, the widest feasible stop percent at this size, and the reward-to-risk ratio when takeProfitPrice is given. Args: pair, side of the stop (SELL protects a long below, BUY protects a short above), quantity in base units, entryPrice, targetPct percent distance, optional takeProfitPrice for RR.",
    capability: "READ",
    riskClass: "read",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  {
    pair: z.string().min(1),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().positive(),
    entryPrice: z.number().positive(),
    targetPct: z.number().positive().max(100),
    takeProfitPrice: z.number().positive().optional(),
  },
);

export function registerRoundingTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(ROUND);
  registry.registerTool(SUGGEST);
  handlers.tools.set("indodax_round_order", async (raw) => {
    try {
      const args = parseArgs(ROUND.inputSchema, raw);
      const symbol = parseSymbolFlexible(args.pair);
      if (!symbol) throw ValidationError(`invalid pair: ${args.pair}`);
      const pair = asPair(symbol);

      // The increment warning is written against the previous cache, so drop it
      // before reading the pair list for rounding.
      clearCache();
      let pairs: PairInfo[];
      try {
        pairs = await getPairsCached(app.publicClient);
      } catch (error) {
        return fail(
          ValidationError(
            `cannot verify precision for ${pair}: the pair list is unreachable ` +
              `(${error instanceof Error ? error.message.slice(0, 100) : "unknown"}); ` +
              "place the exact quantity or retry when the market API responds",
          ),
        );
      }
      const ctx = roundingContextFor(pair, pairs);
      if (ctx === null) {
        return fail(ValidationError(`no tradable market for ${pair}; use indodax_search_symbols`));
      }

      const rounded = roundOrder(
        String(args.quantity),
        args.price === undefined ? null : String(args.price),
        ctx,
      );
      const notional =
        rounded.price === null ? null : new Decimal(rounded.quantity).mul(rounded.price);
      const sizing = assessBudgetSize(notional, args.riskBudget);
      const stop = assessStopRisk({
        price: rounded.price === null ? null : new Decimal(rounded.price),
        stopPrice: args.stopPrice,
        quantity: new Decimal(rounded.quantity),
        budget: args.riskBudget,
      });
      const warnings: string[] = [];
      if (stop.riskWarning !== null) warnings.push(stop.riskWarning);
      // A pair minimum above the budget means no healthy size exists: the
      // exchange refuses anything smaller, and anything it accepts overshoots
      // the budget. State that directly instead of reporting a clean round.
      if (minimumExceedsBudget(ctx.tradeMinQuote, args.riskBudget)) {
        warnings.push(
          `pair minimum notional ${ctx.tradeMinQuote?.toString()} already exceeds ` +
            `your risk budget ${String(args.riskBudget)}; no size satisfies both the ` +
            "exchange minimum and the budget for this pair",
        );
      }
      return ok(
        {
          pair,
          side: args.side ?? null,
          quantity: rounded.quantity,
          price: rounded.price,
          adjusted: rounded.adjusted,
          original: {
            quantity: rounded.quantityOriginal,
            price: rounded.priceOriginal,
          },
          rules: {
            quantityIncrement: ctx.quantityIncrement?.toString() ?? null,
            pricePrecision: ctx.pricePrecision,
            quantityMin: ctx.quantityMin?.toString() ?? null,
            tradeMinQuote: ctx.tradeMinQuote?.toString() ?? null,
          },
          notional: notional?.toString() ?? null,
          ...sizing,
          riskAmount: stop.riskAmount,
          riskMultiple: stop.riskMultiple,
          riskWarning: stop.riskWarning,
          riskNote: stop.riskNote,
          notes: rounded.notes,
          summary: rounded.adjusted
            ? `${pair} rounded to quantity ${rounded.quantity}${rounded.price === null ? "" : ` price ${rounded.price}`}`
            : `${pair} accepts quantity ${rounded.quantity}${rounded.price === null ? "" : ` price ${rounded.price}`} unchanged`,
          remedy: rounded.adjusted
            ? undefined
            : "no rounding was needed, so this quantity and price already match the pair rules",
        },
        warnings,
      );
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_suggest_stop", async (raw) => {
    try {
      const args = parseArgs(SUGGEST.inputSchema, raw);
      const symbol = parseSymbolFlexible(args.pair);
      if (!symbol) throw ValidationError(`invalid pair: ${args.pair}`);
      const pair = asPair(symbol);
      clearCache();
      let pairs: PairInfo[];
      try {
        pairs = await getPairsCached(app.publicClient);
      } catch (error) {
        return fail(
          ValidationError(
            `cannot size a stop for ${pair}: the pair list is unreachable ` +
              `(${error instanceof Error ? error.message.slice(0, 100) : "unknown"}); ` +
              "retry when the market API responds",
          ),
        );
      }
      const ctx = roundingContextFor(pair, pairs);
      if (ctx === null) {
        return fail(ValidationError(`no tradable market for ${pair}; use indodax_search_symbols`));
      }
      const entry = decimalOrNull(args.entryPrice);
      const qty = decimalOrNull(args.quantity);
      if (entry === null || !entry.gt(0) || qty === null || !qty.gt(0)) {
        throw ValidationError("entryPrice and quantity must be positive numbers");
      }
      const distance = entry.mul(args.targetPct).div(100);
      const stopPrice = args.side === "SELL" ? entry.minus(distance) : entry.plus(distance);
      const stopNotional = qty.mul(stopPrice);
      const pairFloor = ctx.tradeMinQuote?.gt(0) ? ctx.tradeMinQuote : null;
      const appFloor = app.limits.minOrderNotional;
      // The binding floor is the stricter of the two: the exchange refuses
      // below the pair floor and risk refuses below the application floor.
      const binding = pairFloor?.gt(appFloor) ? pairFloor : appFloor;
      const meetsMinimum = stopNotional.gte(binding);
      const entryNotional = qty.mul(entry);
      // Widest percent distance whose stop still clears the floor at this
      // size. Null when even the entry notional sits below the floor, in
      // which case no stop distance works and only a bigger size helps.
      const maxFeasiblePct =
        entryNotional.gt(binding) && entry.gt(0)
          ? Number(new Decimal(1).minus(binding.div(entryNotional)).mul(100).toFixed(2))
          : null;
      const minQuantity = stopPrice.gt(0) ? binding.div(stopPrice).toSignificantDigits(6) : null;
      let rr: number | null = null;
      if (args.takeProfitPrice !== undefined) {
        const target = decimalOrNull(args.takeProfitPrice);
        if (target !== null) {
          const reward = target.minus(entry).abs();
          const risk = entry.minus(stopPrice).abs();
          rr = risk.gt(0) ? Number(reward.div(risk).toFixed(2)) : null;
        }
      }
      const warnings: string[] = [];
      if (!meetsMinimum) {
        warnings.push(
          `a ${args.targetPct}% stop on ${qty.toString()} units (${stopNotional.toString()}) ` +
            `cannot clear the ${binding.toString()} floor; ` +
            (maxFeasiblePct === null
              ? "size the position up first"
              : `widen no further than ${maxFeasiblePct}% or size up to at least ` +
                `${minQuantity?.toString() ?? "?"} units`),
        );
      }
      return ok(
        {
          pair,
          side: args.side,
          quantity: qty.toString(),
          entryPrice: entry.toString(),
          targetPct: args.targetPct,
          stopPrice: stopPrice.toString(),
          stopNotional: stopNotional.toString(),
          meetsMinimum,
          floors: {
            pair: pairFloor?.toString() ?? null,
            application: appFloor.toString(),
          },
          minQuantity: minQuantity?.toString() ?? null,
          maxFeasiblePct,
          takeProfitPrice: args.takeProfitPrice === undefined ? null : String(args.takeProfitPrice),
          rr,
          summary: meetsMinimum
            ? `stop ${stopPrice.toString()} clears the floor` +
              (rr === null ? "" : ` with RR ${rr}`)
            : `stop ${stopPrice.toString()} cannot clear the ${binding.toString()} floor`,
        },
        warnings,
      );
    } catch (error) {
      return fail(error);
    }
  });
}

/**
 * Round for real placement, or return null when the pair rules are unknown.
 *
 * Placement must not fail on a rounding rule it could have satisfied, but an
 * unreachable pair list must not block placement either, so an unknown context
 * is a no-op and the caller proceeds with the exact values.
 */
export async function roundForPlacement(
  app: AppServices,
  pair: string,
  quantity: number,
  price: number | undefined,
): Promise<{
  quantity: number;
  price: number | undefined;
  rounded: ReturnType<typeof roundOrder> | null;
}> {
  let pairs: PairInfo[];
  try {
    clearCache();
    pairs = await getPairsCached(app.publicClient);
  } catch {
    return { quantity, price, rounded: null };
  }
  const symbol = parseSymbolFlexible(pair);
  const ctx = symbol === null ? null : roundingContextFor(asPair(symbol), pairs);
  if (ctx === null) return { quantity, price, rounded: null };
  const rounded = roundOrder(String(quantity), price === undefined ? null : String(price), ctx);
  return {
    quantity: Number(rounded.quantity),
    price: rounded.price === null ? undefined : Number(rounded.price),
    rounded,
  };
}

/**
 * Whether the pair minimum alone already breaks the operator budget.
 *
 * Kept as a predicate so the call site reads as one condition instead of a
 * four-part null and range chain.
 */
function minimumExceedsBudget(minimum: Decimal | null, budget: number | undefined): boolean {
  if (budget === undefined || minimum === null) return false;
  return minimum.gt(0) && minimum.gt(budget);
}
