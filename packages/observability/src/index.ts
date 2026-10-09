import type { HealthStatus } from "@d1zzy4-jethools/core";

export interface ComponentHealth {
  status: HealthStatus;
  detail?: string;
}

export type ComponentName =
  | "database"
  | "exchangeRest"
  | "exchangeWs"
  | "mcpTransport"
  | "scheduler"
  | "queue"
  | "deadman"
  | "configuration"
  | "runtime";

export class HealthTracker {
  private readonly components = new Map<ComponentName, ComponentHealth>();

  set(name: ComponentName, health: ComponentHealth): void {
    this.components.set(name, health);
  }

  overall(): HealthStatus {
    if (this.components.size === 0) return "unknown";
    const statuses = [...this.components.values()].map((component) => component.status);
    if (statuses.includes("halted")) return "halted";
    if (statuses.includes("unhealthy")) return "unhealthy";
    if (statuses.includes("degraded")) return "degraded";
    if (statuses.includes("unknown")) return "unknown";
    return "healthy";
  }

  snapshot(): Record<ComponentName, ComponentHealth | { status: "unknown" }> {
    const names: ComponentName[] = [
      "database",
      "exchangeRest",
      "exchangeWs",
      "mcpTransport",
      "scheduler",
      "queue",
      "deadman",
      "configuration",
      "runtime",
    ];
    const out = {} as Record<ComponentName, ComponentHealth | { status: "unknown" }>;
    for (const name of names) out[name] = this.components.get(name) ?? { status: "unknown" };
    return out;
  }
}

export class Counters {
  private readonly values = new Map<string, number>();

  increment(name: string, by = 1): void {
    this.values.set(name, (this.values.get(name) ?? 0) + by);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values);
  }
}
