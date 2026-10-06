import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import { getPairsCached, clearCache } from "@indodax-mcp/indodax-market";
import type { PairInfo } from "@indodax-mcp/indodax-client";
import { parseSymbolFlexible, asPair } from "@indodax-mcp/core";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import { roundOrder, roundingContextFor } from "@indodax-mcp/indodax-mcp/order-rounding";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

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
      "Read-only, places nothing. Round a quantity and price to what one pair actually accepts, using the live pair list. Args: pair required, side only for context, quantity required in base units, optional price. Reports the rounded values, the originals, whether anything changed, and any rule that blocked the order with the real numbers, such as an increment that leaves nothing tradable or a notional under the pair minimum. Money as strings.",
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
  },
);

export function registerRoundingTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(ROUND);
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
      return ok({
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
        notional:
          rounded.price === null
            ? null
            : new Decimal(rounded.quantity).mul(rounded.price).toString(),
        notes: rounded.notes,
        summary: rounded.adjusted
          ? `${pair} rounded to quantity ${rounded.quantity}${rounded.price === null ? "" : ` price ${rounded.price}`}`
          : `${pair} accepts quantity ${rounded.quantity}${rounded.price === null ? "" : ` price ${rounded.price}`} unchanged`,
        remedy: rounded.adjusted
          ? undefined
          : "no rounding was needed, so this quantity and price already match the pair rules",
      });
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
