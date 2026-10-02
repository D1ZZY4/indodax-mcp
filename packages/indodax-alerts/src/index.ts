export type AlertCondition =
  | { type: "above"; price: string }
  | { type: "below"; price: string }
  | { type: "risePct"; percent: string; reference: string }
  | { type: "fallPct"; percent: string; reference: string };

export type AlertStatus = "active" | "triggered" | "cancelled";

export interface PriceAlert {
  id: string;
  pair: string;
  condition: AlertCondition;
  status: AlertStatus;
  note?: string;
  createdAt: string;
  triggeredAt?: string;
}

export function shouldTrigger(condition: AlertCondition, price: number): boolean {
  switch (condition.type) {
    case "above":
      return price >= Number(condition.price);
    case "below":
      return price <= Number(condition.price);
    case "risePct": {
      const reference = Number(condition.reference);
      if (reference <= 0) return false;
      return ((price - reference) / reference) * 100 >= Number(condition.percent);
    }
    case "fallPct": {
      const reference = Number(condition.reference);
      if (reference <= 0) return false;
      return ((reference - price) / reference) * 100 >= Number(condition.percent);
    }
  }
}

export class AlertStore {
  private readonly alerts = new Map<string, PriceAlert>();
  private counter = 1;

  add(alert: Omit<PriceAlert, "id" | "status" | "createdAt">): PriceAlert {
    const record: PriceAlert = {
      ...alert,
      id: `alert-${this.counter}`,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    this.counter += 1;
    this.alerts.set(record.id, record);
    return record;
  }

  list(includeInactive = false): PriceAlert[] {
    return [...this.alerts.values()].filter(
      (alert) => includeInactive || alert.status === "active",
    );
  }

  cancel(id: string): boolean {
    const alert = this.alerts.get(id);
    if (!alert || alert.status !== "active") return false;
    alert.status = "cancelled";
    return true;
  }

  check(pair: string, price: number): PriceAlert[] {
    const triggered: PriceAlert[] = [];
    for (const alert of this.alerts.values()) {
      if (alert.status !== "active" || alert.pair !== pair) continue;
      if (shouldTrigger(alert.condition, price)) {
        alert.status = "triggered";
        alert.triggeredAt = new Date().toISOString();
        triggered.push(alert);
      }
    }
    return triggered;
  }
}
