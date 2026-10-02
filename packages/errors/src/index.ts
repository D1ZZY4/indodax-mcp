export type ErrorCode =
  | "ConfigurationError"
  | "ValidationError"
  | "AuthenticationError"
  | "AuthorizationError"
  | "CapabilityDeniedError"
  | "ExchangeApiError"
  | "ExchangeRateLimitError"
  | "ExchangeNetworkError"
  | "ExchangeTimeoutError"
  | "TimestampError"
  | "NonceError"
  | "OrderRejectedError"
  | "RiskDeniedError"
  | "ReconciliationRequiredError"
  | "UnknownExecutionResultError"
  | "PersistenceError"
  | "WebSocketError"
  | "ProtocolError"
  | "InternalError";

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  operationId: string;
  correlationId?: string | undefined;
  safeMetadata?: Record<string, unknown> | undefined;
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  "ExchangeRateLimitError",
  "ExchangeNetworkError",
  "ExchangeTimeoutError",
]);

let operationCounter = 0;

export function newOperationId(): string {
  operationCounter += 1;
  return `op-${Date.now().toString(36)}-${operationCounter}`;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly operationId: string;
  readonly correlationId?: string | undefined;
  readonly safeMetadata?: Record<string, unknown> | undefined;

  constructor(details: Omit<ErrorDetails, "operationId"> & { operationId?: string }) {
    super(details.message);
    this.name = details.code;
    this.code = details.code;
    this.retryable = details.retryable;
    this.operationId = details.operationId ?? newOperationId();
    this.correlationId = details.correlationId;
    this.safeMetadata = details.safeMetadata;
  }

  toJSON(): ErrorDetails {
    const out: ErrorDetails = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      operationId: this.operationId,
    };
    if (this.correlationId !== undefined) out.correlationId = this.correlationId;
    if (this.safeMetadata !== undefined) out.safeMetadata = this.safeMetadata;
    return out;
  }
}

type Factory = (
  message: string,
  opts?: Partial<Pick<ErrorDetails, "correlationId" | "safeMetadata" | "operationId">>,
) => AppError;

function factory(code: ErrorCode): Factory {
  return (message, opts = {}) =>
    new AppError({ code, message, retryable: RETRYABLE.has(code), ...opts });
}

export const ConfigurationError = factory("ConfigurationError");
export const ValidationError = factory("ValidationError");
export const AuthenticationError = factory("AuthenticationError");
export const AuthorizationError = factory("AuthorizationError");
export const CapabilityDeniedError = factory("CapabilityDeniedError");
export const ExchangeApiError = factory("ExchangeApiError");
export const ExchangeRateLimitError = factory("ExchangeRateLimitError");
export const ExchangeNetworkError = factory("ExchangeNetworkError");
export const ExchangeTimeoutError = factory("ExchangeTimeoutError");
export const TimestampError = factory("TimestampError");
export const NonceError = factory("NonceError");
export const OrderRejectedError = factory("OrderRejectedError");
export const RiskDeniedError = factory("RiskDeniedError");
export const ReconciliationRequiredError = factory("ReconciliationRequiredError");
export const UnknownExecutionResultError = factory("UnknownExecutionResultError");
export const PersistenceError = factory("PersistenceError");
export const WebSocketError = factory("WebSocketError");
export const ProtocolError = factory("ProtocolError");
export const InternalError = factory("InternalError");

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
