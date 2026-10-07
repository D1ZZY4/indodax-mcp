import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { decimalOrNull } from "@indodax-mcp/core";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import {
  canonicalPair,
  pairArg,
  priceArg,
  quantityArg,
  sideArg,
} from "@indodax-mcp/indodax-mcp/schemas";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";
import { assessLiquidity, describeLock } from "@indodax-mcp/indodax-mcp/stop-liquidity";
import { evaluateStops } from "@indodax-mcp/indodax-mcp/stop-trigger";

/**
 * The MCP surface for server-side stops: create, list, cancel, and check.
 *
 * Trigger evaluation lives in `stop-trigger` so the autopoll and this tool
 * share one decision path.
 */
export {
  evaluateStops,
  isLiquidityBlock,
  isRetryableStopFailure,
} from "@indodax-mcp/indodax-mcp/stop-trigger";
export type { StopFireResult } from "@indodax-mcp/indodax-mcp/stop-trigger";

const STOP = {
  capability: "TRADE" as const,
  riskClass: "mutation" as const,
  environmentRequirement: "paper" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "client-key" as const,
  auditClass: "mutation" as const,
};

const STOP_READ = { ...STOP, riskClass: "read" as const, auditClass: "read" as const };

const STOP_SHAPE = {
  pair: pairArg,
  side: sideArg,
  quantity: quantityArg,
  stopPrice: priceArg,
  limitPrice: priceArg.optional(),
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
      "Server-side emulated stop, not exchange-native. Stores a trigger after a notional limit pre-check; nothing is placed until indodax_stop_check or the opt-in autopoll sees the stop price crossed. Stops that share groupId behave as one-cancels-the-other: when one fires, open siblings auto-cancel. Live needs acknowledged true plus the full live gate, recorded as acknowledgedAt. For a live SELL it also checks the asset is actually free: a resting take-profit reserves the quantity it will sell, so a cut-loss on the same quantity would be refused with -2010 when it triggers. A blocked stop is still armed and the response carries a warning naming the locking order plus the fix. Args: pair, side, quantity, stopPrice, optional limitPrice defaulting to stopPrice, optional groupId for OCO linking.",
    ...STOP,
  },
  STOP_SHAPE,
);

const stopsList = defineTool(
  {
    name: "indodax_stops",
    title: "List stops",
    description: "Read-only. List open server-side stops, or include history with history true.",
    ...STOP_READ,
  },
  { history: z.boolean().optional() },
);

const stopCancel = defineTool(
  {
    name: "indodax_stop_cancel",
    title: "Cancel stop",
    description: "Mutating local state. Cancel one open stop by id before it triggers.",
    ...STOP,
  },
  { id: z.string().min(1) },
);

const stopCheck = defineTool(
  {
    name: "indodax_stop_check",
    title: "Check stops",
    description:
      "Mutating when triggers fire. Evaluate open stops against live prices and execute crossed ones as LIMIT orders through risk. Blocked stops retry automatically on every pass and on the opt-in autopoll. A fired stop auto-cancels open siblings in its OCO group. Paper fills nothing by itself; use indodax_paper_fill after.",
    ...STOP,
  },
  {},
);

const stopRetry = defineTool(
  {
    name: "indodax_stop_retry",
    title: "Retry stop",
    description:
      "Mutating when the trigger fires. Re-arm one blocked stop and re-evaluate it against the live price immediately instead of waiting for the next stop_check or autopoll pass. Args: id required. Only a blocked stop needs this; open stops already evaluate on every check.",
    ...STOP,
  },
  { id: z.string().min(1) },
);

export function registerStopTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(stopCreate);
  registry.registerTool(stopsList);
  registry.registerTool(stopCancel);
  registry.registerTool(stopCheck);
  registry.registerTool(stopRetry);

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
      const limitPrice = args.limitPrice ?? args.stopPrice;
      const notional = decimalOrNull(limitPrice)?.mul(decimalOrNull(args.quantity) ?? 0);
      if (notional !== null && notional !== undefined) {
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
        stopPrice: args.stopPrice,
        limitPrice,
        mode,
        ...(args.clientOrderId !== undefined ? { clientOrderId: args.clientOrderId } : {}),
        ...(args.timeInForce !== undefined ? { timeInForce: args.timeInForce } : {}),
        ...(args.stpMode !== undefined ? { stpMode: args.stpMode } : {}),
        ...(args.groupId !== undefined ? { groupId: args.groupId } : {}),
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

  handlers.tools.set("indodax_stops", async (raw) => {
    try {
      const args = parseArgs(stopsList.inputSchema, raw);
      const stops = app.stops.list(args.history ?? false);
      const blocked = stops.filter((stop) => stop.status === "blocked");
      const payload: Record<string, unknown> = {
        count: stops.length,
        open: stops.filter((stop) => stop.status === "open").length,
        // Blocked stops are armed protection that could not place, so they are
        // counted separately rather than folded into `open`: a stop that can
        // never fire is not the same as one that can.
        blocked: blocked.length,
        stops,
        pairs: [...new Set(stops.map((stop) => stop.pair))],
        summary: `${stops.length} stops listed`,
      };
      if (blocked.length > 0) {
        payload.blockedStops = blocked.map((stop) => ({
          id: stop.id,
          pair: stop.pair,
          quantity: stop.quantity,
          reason: stop.blockedReason ?? stop.reason ?? null,
          fix: stop.blockedFix ?? null,
        }));
        payload.note =
          "a blocked stop is still armed protection whose placement was refused; it retries on the next check";
      }
      return ok(payload);
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_stop_cancel", async (raw) => {
    try {
      const args = parseArgs(stopCancel.inputSchema, raw);
      const before = app.stops.list(true).find((stop) => stop.id === args.id) ?? null;
      const cancelled = app.stops.cancel(args.id);
      if (!cancelled) throw ValidationError(`stop ${args.id} is not open`);
      return ok({
        id: args.id,
        status: "cancelled",
        cancelledStop: before,
        remainingOpen: app.stops.list().length,
        summary: `stop ${args.id} cancelled`,
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_stop_check", async () => {
    try {
      const result = await evaluateStops(app);
      const retry = result.fired.filter((entry) => entry.retryable === true);
      const blocked = result.fired.filter((entry) => entry.status === "blocked");
      return ok({
        ...result,
        openStops: app.stops.list().length,
        totalStops: app.stops.list(true).length,
        /** Armed stops whose placement was refused but is worth another cycle. */
        retryable: retry.length,
        retryableStops: retry.map((entry) => ({
          id: entry.id,
          status: entry.status,
          reason: entry.reason,
          fix: entry.fix,
        })),
        /**
         * Stops held up by a reserved quantity, reported on their own.
         *
         * This is the case that produced real losses: the stop triggered, the
         * exchange refused it because a take-profit held the balance, and
         * nothing said so at the time. Naming the blocking order is what turns
         * a silent failure into an action the operator can take.
         */
        blocked: blocked.length,
        blockedStops: blocked.map((entry) => ({
          id: entry.id,
          reason: entry.reason,
          fix: entry.fix,
        })),
        protectionIntact:
          blocked.length > 0
            ? "a stop crossed its price and could not place because the quantity is reserved by another order; it stays armed and retries once that order is cancelled. use indodax_oco_attach to link the two automatically"
            : retry.length > 0
              ? "a stop crossed its price but was not placed; it is still open, refresh the account and check again"
              : null,
        summary:
          blocked.length > 0
            ? `${blocked.length} stop(s) blocked by a reserved quantity, still armed, of ${result.checked} checked`
            : retry.length > 0
              ? `${retry.length} stop(s) still armed after a refreshable failure of ${result.checked} checked`
              : result.fired.length > 0
                ? `${result.fired.length} stop(s) fired of ${result.checked} checked`
                : `${result.checked} stops checked, none crossed`,
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_stop_retry", async (raw) => {
    try {
      const args = parseArgs(stopRetry.inputSchema, raw);
      const existing = app.stops.list(true).find((stop) => stop.id === args.id) ?? null;
      if (existing === null) throw ValidationError(`stop ${args.id} not found`);
      if (existing.status !== "blocked") {
        throw ValidationError(
          `stop ${args.id} is ${existing.status}, not blocked; only a blocked stop ` +
            "needs a retry because open stops already evaluate on every stop_check",
        );
      }
      // Clear the recorded block so this pass judges the live state, not the
      // previous refusal. When the quantity is still reserved the stop blocks
      // again with a fresh assessment instead of hanging on stale evidence.
      app.stops.unblock(args.id);
      const result = await evaluateStops(app);
      const entry = result.fired.find((fired) => fired.id === args.id) ?? null;
      return ok({
        id: args.id,
        status: entry?.status ?? "open",
        result: entry,
        checked: result.checked,
        openStops: app.stops.list().length,
        summary:
          entry === null
            ? `stop ${args.id} re-armed and re-evaluated; no trigger fired on this pass`
            : `stop ${args.id} retried with status ${entry.status}`,
        note: "Blocked stops also retry automatically on every stop_check and autopoll pass.",
      });
    } catch (error) {
      return fail(error);
    }
  });
}
