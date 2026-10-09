import type { Capability, ExecutionMode, RiskDecision } from "@d1zzy4-jethools/core";
import { RiskDeniedError, ValidationError } from "@d1zzy4-jethools/errors";
import type { OrderRecord } from "@d1zzy4-jethools/indodax-orders";

export interface ExecutionRequest {
  order: OrderRecord;
  mode: ExecutionMode;
  capability: Capability;
  correlationId: string;
  requestedAt: string;
}

export interface ExecutionResult {
  internalOrderId: string;
  exchangeOrderId: string | null;
  accepted: boolean;
  message: string;
  executedAt: string;
}

export interface ExecutionBackend {
  readonly name: string;
  submit(request: ExecutionRequest): Promise<ExecutionResult>;
  cancel(internalOrderId: string): Promise<boolean>;
}

export class ExecutionService<Backend extends ExecutionBackend> {
  constructor(private readonly backend: Backend) {}

  get backendName(): string {
    return this.backend.name;
  }

  async execute(request: ExecutionRequest, risk: RiskDecision): Promise<ExecutionResult> {
    if (!isAllow(risk)) throw RiskDeniedError(risk.message);
    // Orders must flow through TradingService review, which moves NEW to
    // SUBMITTING and then to ACCEPTED on ALLOW. Executing any other state
    // would bypass proposal, validation, and risk review.
    if (request.order.state !== "ACCEPTED") {
      throw ValidationError(
        `order ${request.order.internalOrderId} must be ACCEPTED by risk review before execution, got ${request.order.state}`,
      );
    }
    return this.backend.submit(request);
  }
}

function isAllow(risk: RiskDecision): boolean {
  return risk.outcome === "ALLOW";
}

export * from "@d1zzy4-jethools/indodax-execution/live";
