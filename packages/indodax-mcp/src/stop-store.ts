export type StopSide = "BUY" | "SELL";
export type StopMode = "paper" | "live";
/**
 * `blocked` is distinct from `failed` on purpose.
 *
 * A stop whose placement was refused because the quantity is reserved by
 * another order is still armed protection: the price condition held, nothing
 * reached the exchange, and the position is still exposed. Marking that
 * `failed` retired it permanently, which is how a position ended up with an
 * open-looking stop that could never fire. A blocked stop stays open and
 * retryable so a later cycle, after the locking order is gone, can place it.
 */
export type StopStatus = "open" | "triggered" | "cancelled" | "failed" | "blocked";

export interface StopOrder {
  id: string;
  pair: string;
  side: StopSide;
  quantity: number;
  stopPrice: number;
  limitPrice: number;
  mode: StopMode;
  clientOrderId?: string | undefined;
  timeInForce?: "GTC" | "MOC" | undefined;
  stpMode?: "EXPIRE_TAKER" | "EXPIRE_MAKER" | "EXPIRE_BOTH" | undefined;
  /** OCO group: when one stop in the group fires, open siblings auto-cancel. */
  groupId?: string | undefined;
  /**
   * Exchange order id of the linked resting order, when this stop was attached
   * to one with `indodax_oco_attach`.
   *
   * A take-profit order reserves the quantity it will sell, so a cut-loss stop
   * on the same quantity cannot place until that order is gone. Linking the two
   * is what lets the trigger free the balance first instead of being refused.
   */
  linkedOrderId?: string | undefined;
  /** clientOrderId of the linked order, for display and for cancel lookup. */
  linkedClientOrderId?: string | undefined;
  status: StopStatus;
  createdAt: string;
  acknowledgedAt?: string | undefined;
  triggeredAt?: string | undefined;
  /** Set when the stop was refused for a reason a later cycle can clear. */
  blockedReason?: string | undefined;
  /** Action that clears the block, reported so the caller is not left guessing. */
  blockedFix?: string | undefined;
  result?: unknown | undefined;
  reason?: string | undefined;
}

/**
 * Server-side conditional orders. The exchange has no native stop
 * orders, so triggers are evaluated here and executed as plain LIMIT
 * orders through the normal risk-guarded path. Never place anything
 * without a prior explicit acknowledgement stored on the stop itself.
 */
export class StopStore {
  private readonly stops = new Map<string, StopOrder>();
  private counter = 1;

  restore(stored: unknown[]): void {
    this.stops.clear();
    let max = 0;
    for (const item of stored) {
      if (typeof item !== "object" || item === null) continue;
      const candidate = item as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.pair !== "string" ||
        (candidate.side !== "BUY" && candidate.side !== "SELL") ||
        typeof candidate.quantity !== "number" ||
        typeof candidate.stopPrice !== "number" ||
        typeof candidate.limitPrice !== "number" ||
        (candidate.mode !== "paper" && candidate.mode !== "live") ||
        (candidate.status !== "open" &&
          candidate.status !== "triggered" &&
          candidate.status !== "cancelled" &&
          candidate.status !== "failed" &&
          candidate.status !== "blocked") ||
        typeof candidate.createdAt !== "string"
      ) {
        continue;
      }
      const numeric = Number(candidate.id.replace("stop-", ""));
      if (Number.isInteger(numeric) && numeric > max) max = numeric;
      this.stops.set(candidate.id, {
        id: candidate.id,
        pair: candidate.pair,
        side: candidate.side,
        quantity: candidate.quantity,
        stopPrice: candidate.stopPrice,
        limitPrice: candidate.limitPrice,
        mode: candidate.mode,
        status: candidate.status,
        createdAt: candidate.createdAt,
        ...(typeof candidate.clientOrderId === "string"
          ? { clientOrderId: candidate.clientOrderId }
          : {}),
        ...(candidate.timeInForce === "GTC" || candidate.timeInForce === "MOC"
          ? { timeInForce: candidate.timeInForce }
          : {}),
        ...(candidate.stpMode === "EXPIRE_TAKER" ||
        candidate.stpMode === "EXPIRE_MAKER" ||
        candidate.stpMode === "EXPIRE_BOTH"
          ? { stpMode: candidate.stpMode }
          : {}),
        ...(typeof candidate.triggeredAt === "string"
          ? { triggeredAt: candidate.triggeredAt }
          : {}),
        ...(typeof candidate.acknowledgedAt === "string"
          ? { acknowledgedAt: candidate.acknowledgedAt }
          : {}),
        ...(typeof candidate.reason === "string" ? { reason: candidate.reason } : {}),
        ...(typeof candidate.groupId === "string" ? { groupId: candidate.groupId } : {}),
        ...(typeof candidate.linkedOrderId === "string"
          ? { linkedOrderId: candidate.linkedOrderId }
          : {}),
        ...(typeof candidate.linkedClientOrderId === "string"
          ? { linkedClientOrderId: candidate.linkedClientOrderId }
          : {}),
        ...(typeof candidate.blockedReason === "string"
          ? { blockedReason: candidate.blockedReason }
          : {}),
        ...(typeof candidate.blockedFix === "string" ? { blockedFix: candidate.blockedFix } : {}),
      });
    }
    this.counter = max + 1;
  }

  add(stop: Omit<StopOrder, "id" | "status" | "createdAt">): StopOrder {
    const record: StopOrder = {
      ...stop,
      id: `stop-${this.counter}`,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    this.counter += 1;
    this.stops.set(record.id, record);
    return record;
  }

  /**
   * Stops that still protect the position.
   *
   * A blocked stop is armed protection that could not place, so it stays in
   * the active list alongside `open`. Excluding it made a stop with a known
   * unresolved refusal invisible to the very surfaces an operator watches.
   */
  list(includeClosed = false): StopOrder[] {
    return [...this.stops.values()].filter(
      (stop) => includeClosed || stop.status === "open" || stop.status === "blocked",
    );
  }

  cancel(id: string, reason?: string): boolean {
    const stop = this.stops.get(id);
    if (stop?.status !== "open" && stop?.status !== "blocked") return false;
    stop.status = "cancelled";
    if (reason !== undefined) stop.reason = reason;
    return true;
  }

  /** Clear a block so the next evaluation retries the placement. */
  unblock(id: string): boolean {
    const stop = this.stops.get(id);
    if (stop?.status !== "blocked") return false;
    stop.status = "open";
    delete stop.blockedReason;
    delete stop.blockedFix;
    return true;
  }

  mark(id: string, status: StopStatus, extra: Partial<StopOrder> = {}): void {
    const stop = this.stops.get(id);
    if (!stop) return;
    stop.status = status;
    Object.assign(stop, { triggeredAt: new Date().toISOString(), ...extra });
  }
}
