export type StopSide = "BUY" | "SELL";
export type StopMode = "paper" | "live";
export type StopStatus = "open" | "triggered" | "cancelled" | "failed";

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
  status: StopStatus;
  createdAt: string;
  acknowledgedAt?: string | undefined;
  triggeredAt?: string | undefined;
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
          candidate.status !== "failed") ||
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

  list(includeClosed = false): StopOrder[] {
    return [...this.stops.values()].filter((stop) => includeClosed || stop.status === "open");
  }

  cancel(id: string): boolean {
    const stop = this.stops.get(id);
    if (stop?.status !== "open") return false;
    stop.status = "cancelled";
    return true;
  }

  mark(id: string, status: StopStatus, extra: Partial<StopOrder> = {}): void {
    const stop = this.stops.get(id);
    if (!stop) return;
    stop.status = status;
    Object.assign(stop, { triggeredAt: new Date().toISOString(), ...extra });
  }
}
