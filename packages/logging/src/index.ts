import pino, { type LoggerOptions } from "pino";

export interface LogContext {
  service?: string;
  operation?: string;
  requestId?: string;
  correlationId?: string;
  tenantId?: string;
  exchangeAccountId?: string;
  symbol?: string;
  orderId?: string;
  strategyRunId?: string;
  durationMs?: number;
  result?: string;
}

const REDACT_PATHS = [
  "apiSecret",
  "api_secret",
  "*.apiSecret",
  "*.api_secret",
  "INDODAX_API_SECRET",
  "INDODAX_API_KEY",
  "*.INDODAX_API_SECRET",
  "*.INDODAX_API_KEY",
  "authorization",
  "*.authorization",
  "sign",
  "*.sign",
  "signature",
  "*.signature",
  "req.headers.authorization",
  "req.headers.sign",
  "req.headers.x-apikey",
];

export function createLogger(context: LogContext = {}, level = "info"): pino.Logger {
  const options: LoggerOptions = { level, redact: { paths: REDACT_PATHS, censor: "[redacted]" } };
  return pino(options).child({ ...context });
}

export function logContext(base: LogContext, extra: LogContext): LogContext {
  return { ...base, ...extra };
}
