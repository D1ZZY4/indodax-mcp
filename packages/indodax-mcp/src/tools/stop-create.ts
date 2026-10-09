import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@d1zzy4-jethools/errors";
import type { Registry } from "@d1zzy4-jethools/mcp-registry";
import type { ServerHandlers } from "@d1zzy4-jethools/mcp-core";
import { decimalOrNull } from "@d1zzy4-jethools/core";
import { fail, ok, parseArgs } from "@d1zzy4-jethools/mcp-app/respond";
import {
  canonicalPair,
  pairArg,
  priceArg,
  quantityArg,
  sideArg,
} from "@d1zzy4-jethools/mcp-app/schemas";
import { defineTool } from "@d1zzy4-jethools/mcp-app/tools/define";
import { getTicker } from "@d1zzy4-jethools/indodax-market";
import type { AppServices } from "@d1zzy4-jethools/mcp-app/composition";
import { STOP } from "@d1zzy4-jethools/mcp-app/tools/stop-shared";
import { assessLiquidity, describeLock } from "@d1zzy4-jethools/mcp-app/stop-liquidity";

const STOP_SHAPE = {
  pair: pairArg,
  side: sideArg,
  quantity: quantityArg,
  stopPrice: priceArg.optional(),
  limitPrice: priceArg.optional(),
  /**
   * Percent offset from the live price at creation, as an alternative to an
   * explicit stopPrice. percentDown arms a SELL stop below the market,
   * percentUp arms a BUY stop above it. Exactly one of stopPrice,
   * percentDown, percentUp is required.
   */
  percentDown: z.number().positive().max(100).optional(),
  percentUp: z.number().positive().max(100).optional(),
  /**
   * Trailing distance in percent from the best price seen since arming, as an
   * alternative trigger. SELL trails below the highest last, BUY above the
   * lowest last, ratcheting on every check. Exactly one of stopPrice,
   * percentDown, percentUp, trailingPct is required.
   */
  trailingPct: z.number().positive().max(100).optional(),
  mode: z.enum(["paper", "live"]).optional(),
  acknowledged: z.boolean().optional(),
  clientOrderId: z.string().min(1).max(36).optional(),
  timeInForce: z.enum(["GTC", "MOC"]).optional(),
  stpMode: z.enum(["EXPIRE_TAKER", "EXPIRE_MAKER", "EXPIRE_BOTH"]).optional(),
  groupId: z.string().min(1).max(36).optional(),
};

const stopCreate = defineTool(
  {
    name: "indodax_stop_create",
    title: "Create stop",
    description:
      "Server-side emulated stop, not exchange-native. Stores a trigger after a notional limit pre-check; nothing is placed until indodax_stop_check or the opt-in autopoll sees the stop price crossed. Stops that share groupId behave as one-cancels-the-other: when one fires, open siblings auto-cancel. Live needs acknowledged true plus the full live gate, recorded as acknowledgedAt. For a live SELL it also checks the asset is actually free: a resting take-profit reserves the quantity it will sell, so a cut-loss on that same quantity would be refused with -2010 when it triggers. A blocked stop is still armed and the response carries a warning naming the locking order plus the fix. Args: pair, side, quantity, exactly one of stopPrice or percentDown (SELL) or percentUp (BUY) or trailingPct anchored to the live price, optional limitPrice defaulting to the trigger, optional groupId for OCO linking. A stop whose notional cannot clear the minimum is refused with UNDERMINIMUM_STOP carrying the shortfall math instead of arming protection that cannot place.",
    ...STOP,
  },
  STOP_SHAPE,
);

/**
 * Resolve the trigger price from an explicit level or a live-anchored percent.
 *
 * Small positions price their protection as a percent (a -5% cut-loss), not
 * as an absolute level, so percentDown/percentUp anchor to the live last
 * price the same way alert percent modes do. Direction mismatches are
 * refused rather than armed backwards.
 */
async function resolveStopPrice(
  app: AppServices,
  args: {
    pair: string;
    side: "BUY" | "SELL";
    stopPrice?: number | undefined;
    percentDown?: number | undefined;
    percentUp?: number | undefined;
  },
): Promise<number> {
  if (args.stopPrice !== undefined) return args.stopPrice;
  if (args.percentDown !== undefined && args.side !== "SELL") {
    throw ValidationError(
      "percentDown only arms SELL stops below the market; use percentUp for BUY",
    );
  }
  if (args.percentUp !== undefined && args.side !== "BUY") {
    throw ValidationError(
      "percentUp only arms BUY stops above the market; use percentDown for SELL",
    );
  }
  const percent = (args.percentDown ?? args.percentUp) as number;
  const anchor = await liveAnchor(app, args.pair);
  const factor =
    args.side === "SELL" ? new Decimal(1).minus(percent / 100) : new Decimal(1).plus(percent / 100);
  return anchor.mul(factor).toNumber();
}

/** Live last price or a clear refusal when the market is unreachable. */
async function liveAnchor(app: AppServices, pair: string): Promise<Decimal> {
  let last: string;
  try {
    last = (await getTicker(app.publicClient, pair)).last;
  } catch {
    throw ValidationError(
      `anchored stops need a live price for ${pair}; retry online or pass stopPrice`,
    );
  }
  const anchor = decimalOrNull(last);
  if (anchor === null || !anchor.gt(0)) {
    throw ValidationError(`anchored stops need a usable live price for ${pair}`);
  }
  return anchor;
}

/**
 * Initial trigger and ratchet anchor for a trailing stop.
 *
 * Both derive from the live last price at creation: the extreme starts at
 * the market and the trigger sits one trailing distance away from it.
 */
async function resolveTrailing(
  app: AppServices,
  pair: string,
  side: "BUY" | "SELL",
  trailingPct: number,
): Promise<{ trigger: number; extreme: string }> {
  const anchor = await liveAnchor(app, pair);
  const factor =
    side === "SELL"
      ? new Decimal(1).minus(trailingPct / 100)
      : new Decimal(1).plus(trailingPct / 100);
  return { trigger: anchor.mul(factor).toNumber(), extreme: anchor.toString() };
}

/**
 * Refuse a stop that cannot clear the notional floor.
 *
 * Arming it anyway would report protection that fails at trigger time, which
 * is the worst outcome for small positions: the one case that most needs a
 * stop would hold a dead one. The refusal carries the shortfall math and the
 * minimum viable quantity so the harness sizes the position to fit instead.
 */
function underminimumError(
  pair: string,
  quantity: number,
  stopPrice: number,
  notional: Decimal,
  app: AppServices,
): Error {
  const floor = app.limits.minOrderNotional;
  const shortfall = floor.minus(notional);
  const price = decimalOrNull(String(stopPrice));
  const minQty = price?.gt(0) ? floor.div(price).toSignificantDigits(6) : null;
  return ValidationError(
    `UNDERMINIMUM_STOP: stop notional ${notional.toString()} is below minimum ` +
      `${floor.toString()} (shortfall ${shortfall.toString()}). ` +
      (minQty === null
        ? "Raise the quantity or the trigger price so the notional clears the floor, "
        : `A stop at ${String(stopPrice)} needs at least ${minQty.toString()} units to clear it; `) +
      "size the position up front, or monitor with indodax_alert_create instead of arming " +
      "protection that cannot place",
    {
      safeMetadata: {
        reason: "UNDERMINIMUM_STOP",
        pair,
        quantity: String(quantity),
        stopPrice: String(stopPrice),
        notional: notional.toString(),
        minimum: floor.toString(),
        ...(minQty === null ? {} : { minQuantity: minQty.toString() }),
      },
    },
  );
}

export function registerStopCreateTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(stopCreate);

  handlers.tools.set("indodax_stop_create", async (raw) => {
    try {
      const args = parseArgs(stopCreate.inputSchema, raw);
      const mode = args.mode ?? "paper";
      if (mode === "live") {
        if (args.acknowledged !== true) {
          throw ValidationError("live stops need acknowledged true");
        }
        if (app.env.APP_ENV !== "live" || app.env.TRADE_ENABLED !== true) {
          throw ValidationError("live stops need APP_ENV=live and TRADE_ENABLED=true");
        }
        if (!app.accountClient || !app.liveExecutor) {
          throw ValidationError("live stops need API credentials");
        }
      }
      const modes = [
        args.stopPrice !== undefined,
        args.percentDown !== undefined,
        args.percentUp !== undefined,
        args.trailingPct !== undefined,
      ].filter(Boolean).length;
      if (modes !== 1) {
        throw ValidationError(
          "stop needs exactly one of stopPrice, percentDown, percentUp, or trailingPct",
        );
      }
      const trailing =
        args.trailingPct === undefined
          ? null
          : await resolveTrailing(app, args.pair, args.side, args.trailingPct);
      const stopPrice = trailing === null ? await resolveStopPrice(app, args) : trailing.trigger;
      const limitPrice = args.limitPrice ?? stopPrice;
      const notional = decimalOrNull(limitPrice)?.mul(decimalOrNull(args.quantity) ?? 0);
      if (notional !== null && notional !== undefined) {
        if (notional.lt(app.limits.minOrderNotional)) {
          throw underminimumError(args.pair, args.quantity, stopPrice, notional, app);
        }
        if (notional.gt(app.limits.maxOrderNotional)) {
          throw ValidationError(
            `stop notional ${notional.toString()} exceeds maximum ${app.limits.maxOrderNotional.toString()}`,
          );
        }
      }
      /**
       * Live stops are checked against real free balance before they are armed.
       *
       * A resting take-profit reserves the quantity it will sell, so arming a
       * cut-loss on that same quantity produced a stop that reported itself
       * armed and then could never fire: the exchange refused it with -2010 the
       * moment the price crossed. The stop is still created, because it is
       * still the protection the operator asked for, but the response now
       * states the lock and the fix instead of implying the stop is safe.
       */
      const liquidity =
        mode === "live"
          ? await assessLiquidity(app, {
              pair: canonicalPair(args.pair),
              side: args.side,
              quantity: decimalOrNull(args.quantity) ?? new Decimal(0),
            })
          : { blocked: false, locked: null, fix: null };
      const stop = app.stops.add({
        pair: canonicalPair(args.pair),
        side: args.side,
        quantity: args.quantity,
        stopPrice,
        limitPrice,
        mode,
        ...(args.clientOrderId !== undefined ? { clientOrderId: args.clientOrderId } : {}),
        ...(args.timeInForce !== undefined ? { timeInForce: args.timeInForce } : {}),
        ...(args.stpMode !== undefined ? { stpMode: args.stpMode } : {}),
        ...(args.groupId !== undefined ? { groupId: args.groupId } : {}),
        ...(trailing === null || args.trailingPct === undefined
          ? {}
          : { trailPct: args.trailingPct, extremePrice: trailing.extreme }),
        ...(mode === "live" ? { acknowledgedAt: new Date().toISOString() } : {}),
      });
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
        mode: stop.mode,
        totalStops: app.stops.list(true).length,
        summary: `stop ${stop.id} armed for ${stop.pair} ${stop.side} at ${stop.stopPrice}`,
        note: "Emulated server-side; fires only while this server runs via indodax_stop_check or autopoll.",
      };
      if (liquidity.locked !== null) {
        payload.liquidity = {
          blocked: true,
          asset: liquidity.locked.asset,
          required: liquidity.locked.required.toString(),
          free: liquidity.locked.free.toString(),
          reservations: liquidity.locked.reservations,
        };
        payload.warning = warning;
        payload.remedy = liquidity.fix;
      }
      return ok(payload, warning === null ? [] : [warning]);
    } catch (error) {
      return fail(error);
    }
  });
}
