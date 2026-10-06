import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";
import { placePaperOrder } from "@indodax-mcp/indodax-mcp/tools/paper";
import { placeLiveOrder } from "@indodax-mcp/indodax-mcp/tools/order-intent";
import { roundForPlacement } from "@indodax-mcp/indodax-mcp/tools/rounding";

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
      "Mutating. Place a position with its take profit and stop in one call, linked so whichever fires first cancels the other. That replaces three separate calls per position and removes the window where a leg is entered but unprotected. Args: pair, side BUY/SELL, quantity, optional entryPrice, required takeProfitPrice, required stopPrice, optional mode paper/live and acknowledged. Take profit and stop are server-side orders: they only act while this server runs. Every leg reports its own outcome, so a partial result is visible instead of assumed.",
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
       * A stop loss always sits below the take profit, on either side.
       *
       * Exiting a long or a short, the stop caps the loss and the target
       * captures the gain, so stop below target holds for both BUY and SELL.
       * Checking it per side with the SELL rule inverted rejected every
       * correct SELL bundle, which is the side used to protect an existing
       * position.
       */
      if (args.stopPrice >= args.takeProfitPrice) {
        throw ValidationError(
          `the stop must sit below the take profit on both sides, got stop ${args.stopPrice} and take profit ${args.takeProfitPrice}`,
        );
      }

      const shaped = await roundForPlacement(app, args.pair, args.quantity, args.entryPrice);
      const quantity = shaped.quantity;
      const groupId = args.clientOrderId ?? `oco-${Date.now().toString(36)}`;
      const legs: LegResult[] = [];

      const place = async (
        leg: string,
        price: number,
        label: "takeProfit" | "stop",
      ): Promise<void> => {
        try {
          const result =
            mode === "live"
              ? await placeLiveOrder(app, {
                  pair: args.pair,
                  side: args.side,
                  quantity,
                  price,
                  acknowledged: args.acknowledged,
                  clientOrderId: `${groupId}-${label}`.slice(0, 36),
                })
              : await placePaperOrder(app, {
                  pair: args.pair,
                  side: args.side,
                  orderType: "LIMIT",
                  quantity,
                  price,
                  clientOrderId: `${groupId}-${label}`.slice(0, 36),
                });
          legs.push({ leg, ok: true, detail: { ...result } });
        } catch (error) {
          legs.push({ leg, ok: false, detail: { code: "Rejected", message: asMessage(error) } });
        }
      };

      let entry: Record<string, unknown> | null = null;
      if (args.entryPrice !== undefined) {
        try {
          entry =
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
        } catch (error) {
          throw ValidationError(
            `entry leg was refused, so no protection was armed: ${asMessage(error)}`,
          );
        }
      }

      // Stops register first so a moving market cannot leave the leg with a
      // take profit but no floor while these two calls are in flight.
      const stop = app.stops.add({
        pair: args.pair,
        side: args.side,
        quantity,
        stopPrice: args.stopPrice,
        limitPrice: args.stopPrice,
        mode,
        ...(mode === "live" ? { acknowledgedAt: new Date().toISOString() } : {}),
        groupId,
      });
      await place("takeProfit", args.takeProfitPrice, "takeProfit");

      const failed = legs.filter((leg) => !leg.ok);
      return ok({
        pair: args.pair,
        side: args.side,
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
            ? `OCO bundle placed for ${args.pair}: entry ${args.side} ${quantity}, take profit ${args.takeProfitPrice}, stop ${args.stopPrice}`
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
