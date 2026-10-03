export type AuditKind =
  | "AgentIntentCreated"
  | "RiskEvaluationStarted"
  | "RiskApproved"
  | "RiskRejected"
  | "OrderSubmitted"
  | "OrderAccepted"
  | "OrderPartiallyFilled"
  | "OrderFilled"
  | "OrderCancelled"
  | "OrderFailed"
  | "PositionChanged"
  | "ReconciliationFailed"
  | "KillSwitchTriggered"
  | "CapabilityChanged"
  | "LiveModeEnabled"
  | "DeadmanChanged"
  | "StrategyRun"
  | "BacktestRun";

export interface AuditEntry {
  eventId: string;
  timestamp: string;
  correlationId: string;
  sessionId?: string;
  agentId?: string;
  symbol?: string;
  kind: AuditKind;
  decision?: string;
  result?: string;
  reason?: string;
}

let bootId: string | null = null;

export class AuditTrail {
  private readonly entries: AuditEntry[] = [];

  record(entry: Omit<AuditEntry, "eventId" | "timestamp"> & { eventId?: string }): void {
    // Suffix with boot time so ids stay unique across restarts and never
    // collide with rows already persisted to Postgres.
    if (bootId === null) bootId = Date.now().toString(36);
    this.entries.push({
      ...entry,
      eventId: entry.eventId ?? `evt-${bootId}-${this.entries.length + 1}`,
      timestamp: new Date().toISOString(),
    });
  }

  list(): AuditEntry[] {
    return [...this.entries];
  }

  trace(correlationId: string): AuditEntry[] {
    return this.entries.filter((entry) => entry.correlationId === correlationId);
  }

  get length(): number {
    return this.entries.length;
  }
}
