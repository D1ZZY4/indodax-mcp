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

export class AuditTrail {
  private readonly entries: AuditEntry[] = [];

  record(entry: Omit<AuditEntry, "eventId" | "timestamp"> & { eventId?: string }): void {
    this.entries.push({
      ...entry,
      eventId: entry.eventId ?? `evt-${this.entries.length + 1}`,
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
