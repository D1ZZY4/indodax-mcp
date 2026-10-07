import { z } from "zod";
import Decimal from "decimal.js";
import { AuthenticationError, AuthorizationError, ValidationError } from "@indodax-mcp/errors";
import { decimalOrNull } from "@indodax-mcp/core";
import { getTicker } from "@indodax-mcp/indodax-market";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { canonicalPair } from "@indodax-mcp/indodax-mcp/schemas";
import { assessLiquidity, describeLock } from "@indodax-mcp/indodax-mcp/stop-liquidity";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

/**
 * Migration path from manually managed positions.
 *
 * `indodax_oco_bundle` links a take-profit and a cut-loss in one call, but
 * every position opened before it existed has a resting take-profit and no
 * link. Without this tool the only way to protect one was to cancel the
 * take-profit by hand, place the stop, and put the take-profit back, which is
 * exactly the manual midnight work that produced real losses.
 *
 * This attaches a stop to an order that already rests on the exchange. It
 * places nothing and cancels nothing, so it is safe to run against a live
 * position: it only records the link that makes the trigger release the
 * quantity first.
 */

const ATTACH = defineTool(
  {
    name: "indodax_oco_attach",
    title: "Attach stop to resting order",
    description:
      "Mutating local state, needs credentials. Link a cut-loss stop to a resting take-profit so the two behave as one-cancels-the-other: when the stop triggers it cancels that order first, freeing the quantity the exchange has reserved. Use this for positions opened before indodax_oco_bundle, where a take-profit already rests on the exchange and a plain stop would be refused with -2010 every time it fires. Places nothing and cancels nothing: it records the link only. Refuses with DUPLICATE_STOP when a stop already arms the same pair, side, and quantity. Args: orderId required (exchange order id of the resting take-profit), stopPrice required, optional pair to narrow the lookup, optional quantity defaulting to the order quantity, optional limitPrice defaulting to stopPrice, optional groupId, optional acknowledged for live mode.",
    capability: "TRADE",
    riskClass: "mutation",
    environmentRequirement: "any",
    authRequirement: "credentials",
    destructive: false,
    idempotencyClass: "client-key",
    auditClass: "mutation",
  },
  {
    orderId: z.string().min(1),
    stopPrice: z.number().positive(),
    limitPrice: z.number().positive().optional(),
    pair: z.string().min(1).optional(),
    quantity: z.number().positive().optional(),
    groupId: z.string().min(1).max(36).optional(),
    clientOrderId: z.string().min(1).max(36).optional(),
    side: z.enum(["SELL", "BUY"]).optional(),
    acknowledged: z.boolean().optional(),
  },
);

interface RestingOrder {
  orderId?: string | number;
  fullOrderId?: string;
  clientOrderId?: string;
  symbol?: string;
  side?: string;
  price?: string;
  origQty?: string;
  executedQty?: string;
  status?: string;
}

export function registerOcoAttachTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(ATTACH);

  handlers.tools.set("indodax_oco_attach", async (raw) => {
    try {
      const args = parseArgs(ATTACH.inputSchema, raw);
      if (!app.accountClient) {
        throw AuthenticationError("indodax_oco_attach needs API credentials");
      }
      if (args.acknowledged !== true) {
        throw AuthorizationError("attaching a live cut-loss needs acknowledged true");
      }

      // Read the resting order rather than trusting the caller's numbers, so the
      // stop size matches what the exchange is actually holding.
      let candidates: RestingOrder[] = [];
      try {
        const open = await app.accountClient.openOrders(args.pair);
        candidates = Array.isArray(open) ? (open as RestingOrder[]) : [];
      } catch (error) {
        throw ValidationError(
          `could not read open orders: ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`,
        );
      }
      const wanted = String(args.orderId);
      const target = candidates.find(
        (row) =>
          String(row.orderId ?? "") === wanted ||
          String(row.fullOrderId ?? "") === wanted ||
          row.clientOrderId === wanted,
      );
      if (target === undefined) {
        const ids = candidates
          .map((row) => `${row.clientOrderId ?? "?"}(${String(row.orderId ?? "?")})`)
          .join(", ");
        throw ValidationError(
          `no open order matches ${wanted}. open orders: ${ids || "none"}. ` +
            "the order must still rest on the exchange to be linked",
        );
      }
      if (target.symbol === undefined) {
        throw ValidationError(`open order ${wanted} has no symbol and cannot be linked`);
      }
      const pair = canonicalPair(target.symbol);
      const side = args.side ?? (target.side === "BUY" ? "BUY" : "SELL");
      if (target.side !== undefined && target.side.toUpperCase() !== side) {
        throw ValidationError(
          `open order ${wanted} is a ${target.side} order, so the linked stop must be ${target.side} too`,
        );
      }

      const restingQty = decimalOrNull(target.origQty ?? "0") ?? new Decimal(0);
      const executed = decimalOrNull(target.executedQty ?? "0") ?? new Decimal(0);
      const free = restingQty.minus(executed);
      if (free.lte(0)) {
        throw ValidationError(
          `open order ${wanted} is fully executed, so there is nothing left to protect with a stop`,
        );
      }
      const quantity = decimalOrNull(String(args.quantity ?? "")) ?? free;
      if (quantity.gt(free)) {
        throw ValidationError(
          `quantity ${quantity.toString()} exceeds the ${free.toString()} still resting on order ${wanted}`,
        );
      }

      // The stop must not already be standing: a duplicate would double the
      // quantity at the same trigger and one leg would fail on -2010.
      const duplicate = app.stops
        .list(true)
        .find((stop) => stop.linkedOrderId === String(target.orderId ?? target.fullOrderId));
      if (duplicate !== undefined) {
        throw ValidationError(
          `stop ${duplicate.id} is already attached to order ${wanted}; cancel it first to attach another`,
        );
      }

      // One position, one cut-loss: a second stop on the same pair, side, and
      // quantity doubles the protection and leaves a stranded sibling behind
      // when the first one fires (the survivor then blocks forever on the
      // reserved quantity). Refuse the double with a named remedy instead of
      // arming a stop that is certain to confuse the next trigger.
      const armedDouble = app.stops
        .list()
        .find(
          (stop) =>
            stop.pair === pair &&
            stop.side === side &&
            (decimalOrNull(String(stop.quantity)) ?? new Decimal(0)).eq(quantity),
        );
      if (armedDouble !== undefined) {
        throw ValidationError(
          `DUPLICATE_STOP: stop ${armedDouble.id} already arms ${pair} ${side} ` +
            `${quantity.toString()}; cancel it with indodax_stop_cancel before attaching ` +
            "another cut-loss to the same position",
          {
            safeMetadata: {
              reason: "DUPLICATE_STOP",
              stopId: armedDouble.id,
              linkedOrderId: armedDouble.linkedOrderId ?? null,
            },
          },
        );
      }

      const limitPrice = args.limitPrice ?? args.stopPrice;
      const notional = decimalOrNull(String(limitPrice))?.mul(quantity) ?? null;
      if (notional !== null) {
        if (notional.lt(app.limits.minOrderNotional)) {
          throw ValidationError(
            `stop notional ${notional.toString()} is below minimum ${app.limits.minOrderNotional.toString()}`,
          );
        }
        if (notional.gt(app.limits.maxOrderNotional)) {
          throw ValidationError(
            `stop notional ${notional.toString()} exceeds maximum ${app.limits.maxOrderNotional.toString()}`,
          );
        }
      }

      const linkedOrderId = String(target.orderId ?? target.fullOrderId ?? "");
      const liquidity = await assessLiquidity(app, {
        pair,
        side,
        quantity,
        linkedOrderId,
      });
      const stop = app.stops.add({
        pair,
        side,
        quantity: quantity.toNumber(),
        stopPrice: args.stopPrice,
        limitPrice,
        mode: "live",
        linkedOrderId,
        ...(target.clientOrderId === undefined
          ? {}
          : { linkedClientOrderId: target.clientOrderId }),
        ...(args.clientOrderId === undefined ? {} : { clientOrderId: args.clientOrderId }),
        ...(args.groupId === undefined ? {} : { groupId: args.groupId }),
        acknowledgedAt: new Date().toISOString(),
      });

      /**
       * Confirm the trigger really is armed on the correct side of the market.
       *
       * A cut-loss above the market on a long position would fire immediately,
       * so a stop created without checking is a market sell dressed as
       * protection. This is reported rather than refused because the caller may
       * legitimately be attaching after price already moved.
       */
      let marketNote: string | null = null;
      try {
        const ticker = await getTicker(app.publicClient, pair);
        const last = decimalOrNull(ticker.last);
        if (last !== null && side === "SELL" && last.lte(args.stopPrice)) {
          marketNote =
            `market is already at ${last.toString()}, at or below the ${args.stopPrice} stop, ` +
            "so this stop triggers on the next check; confirm that is intended";
        }
      } catch {
        // Market unreadable is not a reason to refuse the link.
      }

      const warning = describeLock(liquidity);
      const payload: Record<string, unknown> = {
        id: stop.id,
        status: stop.status,
        stop,
        pair: stop.pair,
        side: stop.side,
        quantity: stop.quantity,
        stopPrice: stop.stopPrice,
        limitPrice: stop.limitPrice,
        linkedOrderId: stop.linkedOrderId,
        linkedClientOrderId: stop.linkedClientOrderId ?? null,
        restingOrderPrice: target.price ?? null,
        totalStops: app.stops.list(true).length,
        summary:
          `stop ${stop.id} attached to order ${linkedOrderId}` +
          `${target.clientOrderId === undefined ? "" : ` (${target.clientOrderId})`} ` +
          `for ${stop.pair} ${stop.side} ${stop.quantity} at ${stop.stopPrice}`,
        note:
          "Places nothing and cancelled nothing. When this stop triggers it cancels the linked " +
          "take-profit first, so the reserved quantity is free and the stop can actually place.",
      };
      if (liquidity.locked !== null) {
        payload.liquidity = {
          blocked: true,
          asset: liquidity.locked.asset,
          required: liquidity.locked.required.toString(),
          free: liquidity.locked.free.toString(),
          reservations: liquidity.locked.reservations,
        };
        payload.remedy = liquidity.fix;
      }
      if (marketNote !== null) payload.marketNote = marketNote;
      return ok(
        payload,
        warning === null ? [] : [warning, marketNote].filter((n): n is string => n !== null),
      );
    } catch (error) {
      return fail(error);
    }
  });
}
