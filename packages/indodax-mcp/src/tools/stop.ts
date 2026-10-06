import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker } from "@indodax-mcp/indodax-market";
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
import { placeLiveOrder } from "@indodax-mcp/indodax-mcp/tools/order-intent";
import { placePaperOrder } from "@indodax-mcp/indodax-mcp/tools/paper";

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

function crossed(side: "BUY" | "SELL", last: string, stopPrice: number): boolean {
  const current = decimalOrNull(last);
  const trigger = decimalOrNull(String(stopPrice));
  if (current === null || trigger === null) return false;
  return side === "SELL" ? current.lte(trigger) : current.gte(trigger);
}

export interface StopFireResult {
  checked: number;
  fired: {
    id: string;
    status: string;
    price?: string;
    reason?: string;
    /** True when a later cycle could still succeed after the named remedy. */
    retryable?: boolean;
    /** The next action, present on a retryable failure. */
    fix?: string;
    cancelledSiblings?: string[];
  }[];
}

/**
 * Whether a placement refusal can still be cleared by a later cycle.
 *
 * Local context refusals are the ones worth retrying: the price condition
 * already held, the stop never reached the exchange, and the position is
 * still unprotected. Anything the exchange itself refused is terminal,
 * because resubmitting the same order would only be refused again.
 */
export function isRetryableStopFailure(reason: string): boolean {
  if (/^denied: (STALE_ACCOUNT_STATE|STALE_MARKET_DATA)\b/.test(reason)) return true;
  return /\b(COOLDOWN_ACTIVE)\b/.test(reason);
}

/** Cancel the open siblings of a fired stop (pseudo-OCO within one group). */
function cancelOcoSiblings(app: AppServices, firedId: string, groupId: string): string[] {
  const cancelled: string[] = [];
  for (const sibling of app.stops.list()) {
    if (sibling.id === firedId || sibling.groupId !== groupId || sibling.status !== "open") {
      continue;
    }
    if (app.stops.cancel(sibling.id, `oco-cancelled by ${firedId}`)) {
      cancelled.push(sibling.id);
    }
  }
  return cancelled;
}

/** Shared trigger evaluation used by the tool and the optional autopoll job. */
export async function evaluateStops(app: AppServices): Promise<StopFireResult> {
  const fired: StopFireResult["fired"] = [];
  for (const stop of app.stops.list()) {
    let last: string | null = null;
    try {
      const ticker = await getTicker(app.publicClient, stop.pair);
      const parsed = decimalOrNull(ticker.last);
      last = parsed ? parsed.toString() : null;
    } catch {
      last = null;
    }
    if (last === null || !crossed(stop.side, last, stop.stopPrice)) continue;
    try {
      const result =
        stop.mode === "live"
          ? await placeLiveOrder(app, {
              pair: stop.pair,
              side: stop.side,
              quantity: stop.quantity,
              price: stop.limitPrice,
              ...(stop.clientOrderId !== undefined ? { clientOrderId: stop.clientOrderId } : {}),
              ...(stop.timeInForce !== undefined ? { timeInForce: stop.timeInForce } : {}),
              ...(stop.stpMode !== undefined ? { stpMode: stop.stpMode } : {}),
              acknowledged: true,
            })
          : await placePaperOrder(app, {
              pair: stop.pair,
              side: stop.side,
              orderType: "LIMIT",
              price: stop.limitPrice,
              quantity: stop.quantity,
              ...(stop.clientOrderId !== undefined ? { clientOrderId: stop.clientOrderId } : {}),
            });
      app.stops.mark(stop.id, "triggered", { result });
      const entry: StopFireResult["fired"][number] = {
        id: stop.id,
        status: "triggered",
        price: last,
      };
      if (stop.groupId !== undefined) {
        const siblings = cancelOcoSiblings(app, stop.id, stop.groupId);
        if (siblings.length > 0) entry.cancelledSiblings = siblings;
      }
      fired.push(entry);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      /**
       * A rejection that a later cycle could still clear must not retire the
       * stop. A stop whose placement was refused because the account snapshot
       * went stale is still armed protection: marking it failed removed it
       * from the open list, so the loop saw no stop and the position stayed
       * uncovered while the price kept moving. Such a stop stays open, keeps
       * its protection, and is reported as retryable so the caller refreshes
       * the account and runs the check again.
       */
      const retryable = isRetryableStopFailure(reason);
      if (retryable) {
        fired.push({
          id: stop.id,
          status: "retry",
          price: last,
          reason,
          retryable: true,
          fix: "refresh the account with indodax_account, then run indodax_stop_check again; this stop is still armed",
        });
        continue;
      }
      app.stops.mark(stop.id, "failed", { reason });
      fired.push({ id: stop.id, status: "failed", reason, retryable: false });
    }
  }
  return { checked: app.stops.list(true).length, fired };
}

const stopCreate = defineTool(
  {
    name: "indodax_stop_create",
    title: "Create stop",
    description:
      "Server-side emulated stop, not exchange-native. Stores a trigger after a notional limit pre-check; nothing is placed until indodax_stop_check or the opt-in autopoll sees the stop price crossed. Stops that share groupId behave as one-cancels-the-other: when one fires, open siblings auto-cancel. Live needs acknowledged true plus the full live gate, recorded as acknowledgedAt. Args: pair, side, quantity, stopPrice, optional limitPrice defaulting to stopPrice, optional groupId for OCO linking.",
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
      "Mutating when triggers fire. Evaluate open stops against live prices and execute crossed ones as LIMIT orders through risk. A fired stop auto-cancels open siblings in its OCO group. Paper fills nothing by itself; use indodax_paper_fill after.",
    ...STOP,
  },
  {},
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
      return ok({
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
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_stops", async (raw) => {
    try {
      const args = parseArgs(stopsList.inputSchema, raw);
      const stops = app.stops.list(args.history ?? false);
      return ok({
        count: stops.length,
        open: stops.filter((stop) => stop.status === "open").length,
        stops,
        pairs: [...new Set(stops.map((stop) => stop.pair))],
        summary: `${stops.length} stops listed`,
      });
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
      return ok({
        ...result,
        openStops: app.stops.list().length,
        totalStops: app.stops.list(true).length,
        /** Armed stops whose placement was refused but is worth another cycle. */
        retryable: retry.length,
        retryableStops: retry.map((entry) => ({
          id: entry.id,
          reason: entry.reason,
          fix: entry.fix,
        })),
        protectionIntact:
          retry.length > 0
            ? "a stop crossed its price but was not placed; it is still open, refresh the account and check again"
            : null,
        summary:
          retry.length > 0
            ? `${retry.length} stop(s) still armed after a refreshable failure of ${result.checked} checked`
            : result.fired.length > 0
              ? `${result.fired.length} stop(s) fired of ${result.checked} checked`
              : `${result.checked} stops checked, none crossed`,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
