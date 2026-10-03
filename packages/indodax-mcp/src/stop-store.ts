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
