import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import { decimalOrNull } from "@indodax-mcp/core";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { canonicalPair } from "@indodax-mcp/mcp-app/schemas";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";
import { placePaperOrder } from "@indodax-mcp/mcp-app/tools/paper";
import { placeLiveOrder } from "@indodax-mcp/mcp-app/tools/order-intent";
import { roundForPlacement } from "@indodax-mcp/mcp-app/tools/rounding";

/**
 * One call per position.
 *
 * Setting up a leg took four round trips: open the position, place a take
 * profit, arm the stop, and add an alert. Each step was independent, so a
 * failure between them left a leg half protected with no indication which
 * half. This places the protection in one call and reports each leg's result
 * separately, so a partial outcome is visible rather than assumed.
 */

const OCO = defineTool(
  {
    name: "indodax_oco_bundle",
    title: "OCO bundle",
    description:
      "Mutating. Place a position with its take profit and stop in one call, linked so whichever fires first cancels the other. That replaces three separate calls per position and removes the window where a leg is entered but unprotected. Args: pair, side BUY/SELL naming the position direction, quantity, optional entryPrice, required takeProfitPrice, required stopPrice, optional mode paper/live and acknowledged. With entryPrice, the entry follows side and the take profit plus stop exit opposite (BUY entry yields SELL take profit and SELL stop); without entryPrice the legs follow side to protect an already-open position. Every leg notional is validated before anything is placed, so an undersized stop refuses the whole bundle instead of arming unprotectable legs. Every leg reports its own outcome with its side, so a partial result is visible instead of assumed.",
    capability: "TRADE",
    riskClass: "mutation",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "client-key",
    auditClass: "mutation",
  },
  {
    pair: z.string().min(1),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().positive(),
    entryPrice: z.number().positive().optional(),
    takeProfitPrice: z.number().positive(),
    stopPrice: z.number().positive(),
    mode: z.enum(["paper", "live"]).optional(),
    acknowledged: z.boolean().optional(),
    clientOrderId: z.string().min(1).max(36).optional(),
  },
);

type LegResult = { leg: string; ok: boolean; detail: Record<string, unknown> };

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The exchange id a placed leg came back with.
 *
 * Read defensively across both spellings the adapters use, because the link is
 * what lets the stop release the quantity later. A missing id is not fatal:
 * the stop still works, it just cannot pre-empt the take-profit.
 */
function extractExchangeOrderId(detail: Record<string, unknown>): string | null {
  const value = detail.exchangeOrderId;
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/** The side that closes a position opened in the given direction. */
function oppositeSide(side: "BUY" | "SELL"): "BUY" | "SELL" {
  return side === "BUY" ? "SELL" : "BUY";
}

/**
 * Refuse the whole bundle when any leg cannot satisfy the notional limits.
 *
 * Runs before the first placement so a bundle never opens a position it
 * cannot protect: an undersized stop would otherwise arm silently and fail
 * at trigger time. Each leg is checked at the rounded bundle quantity,
 * matching what each leg would actually place.
 */
function validateBundleNotionals(
  app: AppServices,
  quantity: number,
  legs: { leg: string; price: number }[],
): void {
  const qty = decimalOrNull(String(quantity));
  if (qty === null || !qty.gt(0)) throw ValidationError("bundle quantity must be positive");
  for (const { leg, price } of legs) {
    const px = decimalOrNull(String(price));
    if (px === null || !px.gt(0)) throw ValidationError(`${leg} leg price must be positive`);
    const notional = qty.mul(px);
    if (notional.lt(app.limits.minOrderNotional)) {
      throw ValidationError(
        `${leg} leg notional ${notional.toString()} is below minimum ` +
          `${app.limits.minOrderNotional.toString()} (MIN_ORDER_SIZE); the bundle cannot ` +
          "protect this size, so nothing was placed",
      );
    }
    if (notional.gt(app.limits.maxOrderNotional)) {
      throw ValidationError(
        `${leg} leg notional ${notional.toString()} exceeds maximum ` +
          `${app.limits.maxOrderNotional.toString()} (MAX_ORDER_SIZE); nothing was placed`,
      );
    }
  }
}

export function registerOcoTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(OCO);
  handlers.tools.set("indodax_oco_bundle", async (raw) => {
    try {
      const args = parseArgs(OCO.inputSchema, raw);
      const mode = args.mode ?? "paper";

      /**
       * Which side closes the position.
       *
       * With an entry leg, side names the position being opened (BUY opens a
       * long), so both exits must oppose it: a BUY entry yields a SELL take
       * profit and a SELL stop. Placing the exits in the entry direction
       * doubled the position instead of protecting it. Without an entry leg
       * the bundle protects an already-open position, so the legs follow
       * side itself (SELL exits close a long, BUY exits close a short).
       */
      const exitSide = args.entryPrice === undefined ? args.side : oppositeSide(args.side);

      /**
       * The stop sits on the loss side of the take profit, judged from the
       * exits: below the target when exiting SELL, above it when exiting BUY.
       */
      if (exitSide === "SELL" && args.stopPrice >= args.takeProfitPrice) {
        throw ValidationError(
          `with SELL exits the stop must sit below the take profit, got stop ${args.stopPrice} and take profit ${args.takeProfitPrice}`,
        );
      }
      if (exitSide === "BUY" && args.stopPrice <= args.takeProfitPrice) {
        throw ValidationError(
          `with BUY exits the stop must sit above the take profit, got stop ${args.stopPrice} and take profit ${args.takeProfitPrice}`,
        );
      }

      const shaped = await roundForPlacement(app, args.pair, args.quantity, args.entryPrice);
      const quantity = shaped.quantity;
      // Every leg notional is validated before anything is placed. A stop
      // that cannot satisfy the pair minimum would otherwise arm silently and
      // fail at trigger time, leaving the position exactly as unprotected as
      // having no stop while reporting protection.
      validateBundleNotionals(app, quantity, [
        ...(args.entryPrice === undefined ? [] : [{ leg: "entry", price: args.entryPrice }]),
        { leg: "takeProfit", price: args.takeProfitPrice },
        { leg: "stop", price: args.stopPrice },
      ]);
      const groupId = args.clientOrderId ?? `oco-${Date.now().toString(36)}`;
      const legs: LegResult[] = [];

      /**
       * Every leg is one decision, so each leg after the first skips only the
       * inter-order cooldown. The risk engine still evaluates limits, deadman,
       * balance, and reconciliation for each leg individually, and the entry
       * leg is still refused outright when it fails.
       *
       * `placedLegs` counts the entry too, so a bundle that opens a position
       * and then places its take profit does not have that second leg refused
       * by the cooldown the first leg just started.
       */
      let placedLegs = 0;
      const place = async (
        leg: string,
        price: number,
        label: "takeProfit" | "stop",
      ): Promise<void> => {
        const continuation = placedLegs > 0;
        placedLegs += 1;
        try {
          const result =
            mode === "live"
              ? await placeLiveOrder(app, {
                  pair: args.pair,
                  side: exitSide,
                  quantity,
                  price,
                  acknowledged: args.acknowledged,
                  clientOrderId: `${groupId}-${label}`.slice(0, 36),
                  ignoreCooldown: continuation,
                })
              : await placePaperOrder(app, {
                  pair: args.pair,
                  side: exitSide,
                  orderType: "LIMIT",
                  quantity,
                  price,
                  clientOrderId: `${groupId}-${label}`.slice(0, 36),
                  ignoreCooldown: continuation,
                });
          legs.push({ leg, ok: true, detail: { ...result, side: exitSide } });
        } catch (error) {
          legs.push({
            leg,
            ok: false,
            detail: { code: "Rejected", message: asMessage(error), side: exitSide },
          });
        }
      };

      let entry: Record<string, unknown> | null = null;
      if (args.entryPrice !== undefined) {
        try {
          const placed =
            mode === "live"
              ? ((await placeLiveOrder(app, {
                  pair: args.pair,
                  side: args.side,
                  quantity,
                  price: args.entryPrice,
                  acknowledged: args.acknowledged,
                  clientOrderId: groupId,
                })) as unknown as Record<string, unknown>)
              : ((await placePaperOrder(app, {
                  pair: args.pair,
                  side: args.side,
                  orderType: "LIMIT",
                  quantity,
                  price: args.entryPrice,
                  clientOrderId: groupId,
                })) as unknown as Record<string, unknown>);
          entry = { ...placed, side: args.side };
        } catch (error) {
          throw ValidationError(
            `entry leg was refused, so no protection was armed: ${asMessage(error)}`,
          );
        }
        // Counted so the following take-profit leg is treated as a
        // continuation of this same decision rather than a fresh submission.
        placedLegs += 1;
      }

      // The take-profit is placed first so its exchange order id is known, and
      // the stop is then registered linked to it.
      //
      // The link is what makes the pair survivable: a resting take-profit
      // reserves the quantity, so an unlinked cut-loss on that same quantity
      // is refused with -2010 every time it triggers. Registering the stop
      // first instead would produce a stop that reported itself armed and
      // could never place. Nothing is exposed in between, because a stop only
      // fires inside an evaluateStops pass, not during this call.
      await place("takeProfit", args.takeProfitPrice, "takeProfit");
      const takeProfitLeg = legs.find((leg) => leg.leg === "takeProfit");
      const linkedOrderId = takeProfitLeg?.ok ? extractExchangeOrderId(takeProfitLeg.detail) : null;
      const stop = app.stops.add({
        pair: canonicalPair(args.pair),
        side: exitSide,
        quantity,
        stopPrice: args.stopPrice,
        limitPrice: args.stopPrice,
        mode,
        ...(mode === "live" ? { acknowledgedAt: new Date().toISOString() } : {}),
        groupId,
        ...(linkedOrderId === null ? {} : { linkedOrderId }),
      });

      const failed = legs.filter((leg) => !leg.ok);
      return ok({
        pair: args.pair,
        side: args.side,
        exitSide,
        mode,
        quantity,
        groupId,
        entry,
        stopId: stop.id,
        legs,
        /** True when at least one protection leg was refused. */
        partial: failed.length > 0,
        status: failed.length === 0 ? "complete" : "partial",
        note:
          failed.length === 0
            ? "position and both protection legs placed and linked"
            : `protection incomplete (${failed.map((leg) => leg.leg).join(", ")}); the position is not fully hedged until those are placed`,
        summary:
          failed.length === 0
            ? `OCO bundle placed for ${args.pair}: entry ${args.side} ${quantity}, take profit ${exitSide} ${args.takeProfitPrice}, stop ${exitSide} ${args.stopPrice}`
            : `OCO bundle partial for ${args.pair}: ${failed.map((leg) => leg.leg).join(", ")} refused`,
        remedy:
          failed.length === 0
            ? undefined
            : `place ${failed.map((leg) => leg.leg).join(" and ")} manually; the take profit and stop are server-side and only act while this server runs`,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
