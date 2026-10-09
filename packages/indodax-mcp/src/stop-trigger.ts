import Decimal from "decimal.js";
import { getTicker } from "@indodax-mcp/indodax-market";
import { decimalOrNull } from "@indodax-mcp/core";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";
import type { StopOrder } from "@indodax-mcp/mcp-app/stop-store";
import { assessLiquidity } from "@indodax-mcp/mcp-app/stop-liquidity";
import { isLiquidityBlock, isRetryableStopFailure } from "@indodax-mcp/mcp-app/stop-classification";
import { placeLiveOrder } from "@indodax-mcp/mcp-app/tools/order-intent";
import { placePaperOrder } from "@indodax-mcp/mcp-app/tools/paper";

/**
 * Stop trigger evaluation, shared by `indodax_stop_check` and the autopoll.
 *
 * This is the half of the stop tool that decides whether protection actually
 * executes: it reads the market, releases a linked take-profit, places the
 * order, and classifies whatever the exchange answers with. Keeping it apart
 * from the MCP surface means the autopoll and the tool share one decision
 * path rather than two that can drift.
 */

function crossed(side: "BUY" | "SELL", last: string, stopPrice: number): boolean {
  const current = decimalOrNull(last);
  const trigger = decimalOrNull(String(stopPrice));
  if (current === null || trigger === null) return false;
  return side === "SELL" ? current.lte(trigger) : current.gte(trigger);
}

export interface StopFireResult {
  /** Stops this pass examined, not the lifetime stop history. */
  checked: number;
  fired: {
    id: string;
    status: string;
    /** Market last price at the crossing. Compare with triggerPrice for slippage. */
    price?: string;
    /** The stopPrice setting that armed this trigger. */
    triggerPrice?: number;
    /** The limit price the placement used. */
    limitPrice?: number;
    reason?: string;
    /** True when a later cycle could still succeed after the named remedy. */
    retryable?: boolean;
    /** The next action, present on a retryable failure. */
    fix?: string;
    cancelledSiblings?: string[];
    /** Take-profit orders cancelled to free the quantity for this stop. */
    cancelledLinkedOrders?: string[];
  }[];
}

/**
 * Cancel the take-profit a stop is linked to, so the quantity is free.
 *
 * The link is the point of `indodax_oco_attach`: without it a stop and a
 * take-profit compete for the same reserved balance and the stop always loses,
 * because the take-profit is placed first and holds the funds. Cancelling the
 * linked order before placing is what makes an OCO group an action rather than
 * a label.
 *
 * Only the explicitly linked order is released. Cancelling whatever happens to
 * match the pair would be a much larger action than the operator authorised.
 */
async function releaseLinkedOrder(app: AppServices, stop: StopOrder): Promise<string[]> {
  const linked = stop.linkedOrderId;
  if (linked === undefined || app.liveExecutor === null) return [];
  try {
    const cancelled = await app.liveExecutor.cancelByExchangeId(stop.pair, linked);
    return cancelled ? [linked] : [];
  } catch (error) {
    // A link that can no longer be cancelled must not block the placement: the
    // exchange is the authority on whether the quantity is free, and the caller
    // still gets a definitive answer from the placement attempt.
    app.logger.warn(
      { stop: stop.id, linkedOrderId: linked, error: String(error) },
      "linked take-profit could not be cancelled; attempting stop placement anyway",
    );
    return [];
  }
}

/**
 * Explain a blocked stop in terms the operator can act on.
 *
 * Names the locking orders and the free balance, so the response says what to
 * do rather than restating the exchange code.
 */
async function describeBlock(app: AppServices, stop: StopOrder, reason: string): Promise<string> {
  const assessment = await assessLiquidity(app, {
    pair: stop.pair,
    side: stop.side,
    quantity: decimalOrNull(String(stop.quantity)) ?? new Decimal(0),
    ...(stop.linkedOrderId !== undefined ? { linkedOrderId: stop.linkedOrderId } : {}),
  });
  if (assessment.fix !== null) return assessment.fix;
  if (assessment.blocked) {
    return `${reason}. the quantity is not free; cancel the reserving order and run indodax_stop_check again`;
  }
  return `${reason}. free the asset or lower the stop quantity, then run indodax_stop_check again`;
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

/**
 * Advance a trailing stop's extreme to the latest favorable print.
 *
 * SELL trails below the highest seen price, BUY above the lowest seen one.
 * The extreme persists through the store so a restart re-anchors from
 * recorded evidence instead of inventing a fresh anchor that could skip a
 * trigger the market already crossed.
 */
function ratchetExtreme(app: AppServices, stop: StopOrder, last: string): string | null {
  const current = decimalOrNull(last);
  if (current === null) return null;
  const stored = stop.extremePrice === undefined ? null : decimalOrNull(stop.extremePrice);
  const extreme =
    stored === null
      ? current
      : stop.side === "SELL"
        ? Decimal.max(stored, current)
        : Decimal.min(stored, current);
  if (stored === null || !stored.eq(extreme)) {
    app.stops.touch(stop.id, { extremePrice: extreme.toString() });
  }
  return extreme.toString();
}

/** Shared trigger evaluation used by the tool and the optional autopoll job. */
export async function evaluateStops(app: AppServices): Promise<StopFireResult> {
  const fired: StopFireResult["fired"] = [];
  // Counted before the loop so `checked` describes what this pass examined.
  // Reading it from list(true) afterwards counts cancelled and triggered
  // history too, which reported more stops checked than were ever evaluated.
  const open = app.stops.list();

  /**
   * Refresh the account snapshot before any live stop is evaluated.
   *
   * The risk engine denies live placement when the account snapshot is older
   * than its limit, and nothing on the autopoll path ever refreshed it. A
   * server left on autopoll therefore hit STALE_ACCOUNT_STATE on every trigger
   * and the stop silently died unless a human happened to call
   * indodax_account first. Refreshing here makes the autopoll self-sufficient:
   * the trigger decides on live balances rather than on whatever the last
   * unrelated read happened to leave behind.
   */
  if (open.some((stop) => stop.mode === "live") && app.accountClient !== null) {
    try {
      await app.accountClient.getAccount();
      app.accountSyncedAt = Date.now();
    } catch (error) {
      // A failed refresh leaves the previous snapshot in place, so the risk
      // engine still applies its staleness rule rather than acting on a guess.
      app.logger.warn({ error: String(error) }, "stop evaluation could not refresh the account");
    }
  }

  for (const stop of open) {
    let last: string | null = null;
    try {
      const ticker = await getTicker(app.publicClient, stop.pair);
      const parsed = decimalOrNull(ticker.last);
      last = parsed ? parsed.toString() : null;
    } catch {
      last = null;
    }
    if (last === null) continue;
    // Trailing stops chase the market instead of watching a fixed level: the
    // extreme ratchets with every favorable print and the trigger trails one
    // distance behind it. The stored stopPrice stays as the arming record;
    // the live trigger below is what the crossing tests.
    let trigger = stop.stopPrice;
    if (stop.trailPct !== undefined && stop.trailPct !== null) {
      const extreme = ratchetExtreme(app, stop, last);
      if (extreme === null) continue;
      const pct = decimalOrNull(stop.trailPct);
      const anchor = decimalOrNull(extreme);
      if (pct === null || anchor === null) continue;
      const factor =
        stop.side === "SELL"
          ? new Decimal(1).minus(pct.div(100))
          : new Decimal(1).plus(pct.div(100));
      trigger = anchor.mul(factor).toNumber();
    }
    if (!crossed(stop.side, last, trigger)) continue;

    /**
     * Free the quantity before placing, then place.
     *
     * The exchange reserves balance per open order, so a take-profit SELL holds
     * the quantity a cut-loss SELL needs. Firing blind produced -2010 on every
     * trigger and left the position unprotected. This cancels the linked
     * take-profit first, so the two orders stop competing for the same balance
     * and whichever price was actually reached gets executed.
     */
    const released = await releaseLinkedOrder(app, stop);
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
      app.stops.mark(stop.id, "triggered", { result, triggeredPrice: last });
      const entry: StopFireResult["fired"][number] = {
        id: stop.id,
        status: "triggered",
        price: last,
        triggerPrice: trigger,
        limitPrice: stop.limitPrice,
      };
      if (released.length > 0) entry.cancelledLinkedOrders = released;
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
          triggerPrice: trigger,
          limitPrice: stop.limitPrice,
          reason,
          retryable: true,
          fix: "refresh the account with indodax_account, then run indodax_stop_check again; this stop is still armed",
        });
        continue;
      }
      /**
       * Insufficient balance is a block, not a failure.
       *
       * The stop is still armed protection whose placement was refused, and the
       * cause is usually a resting take-profit reserving the same quantity.
       * Marking it `failed` retired it permanently, which is exactly how an
       * open-looking stop disappeared and a position ran unprotected. A blocked
       * stop stays in the active list, is reported with the fix, and a later
       * cycle retries it.
       */
      if (isLiquidityBlock(reason)) {
        const blocked = await describeBlock(app, stop, reason);
        app.stops.mark(stop.id, "blocked", {
          reason,
          blockedReason: reason,
          blockedFix: blocked,
        });
        fired.push({
          id: stop.id,
          status: "blocked",
          price: last,
          triggerPrice: trigger,
          limitPrice: stop.limitPrice,
          reason,
          retryable: true,
          fix: blocked,
        });
        continue;
      }
      app.stops.mark(stop.id, "failed", { reason, triggeredPrice: last });
      fired.push({
        id: stop.id,
        status: "failed",
        price: last,
        triggerPrice: trigger,
        limitPrice: stop.limitPrice,
        reason,
        retryable: false,
      });
    }
  }
  return { checked: open.length, fired };
}
