import {
  ExchangeApiError,
  ExchangeNetworkError,
  ExchangeRateLimitError,
  ExchangeTimeoutError,
} from "@indodax-mcp/errors";

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  timeoutMs: number;
  /**
   * Retry classification for state-changing requests. Safe methods
   * (GET/HEAD/OPTIONS) are always retried on 429/5xx/timeout. Unsafe
   * methods (POST/PUT/PATCH/DELETE) are attempted exactly once unless
   * this flag is true, because a lost response after a successful
   * submission would otherwise risk duplicate execution. Callers that
   * can prove idempotency (client order keys, exchange dedup) opt in.
   */
  retryStateChanging?: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 500,
  timeoutMs: 30_000,
  retryStateChanging: false,
};

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function backoffDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** (attempt - 1);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function requestMethod(init: RequestInit): string {
  const method = init.method ?? "GET";
  return method.toUpperCase();
}

function isStateChanging(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  fetchFn: FetchFn = fetch,
): Promise<Response> {
  let lastError: Error | null = null;
  const stateChanging = isStateChanging(requestMethod(init));
  const attempts = stateChanging && policy.retryStateChanging !== true ? 1 : policy.maxAttempts;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, backoffDelay(attempt - 1, policy.baseDelayMs)),
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const response = await fetchFn(url, { ...init, signal: controller.signal });
      if (response.ok) return response;
      if (response.status === 429) {
        lastError = new Error(`rate limited (HTTP ${response.status})`);
        continue;
      }
      if (isRetryableStatus(response.status)) {
        lastError = new Error(`server error (HTTP ${response.status})`);
        continue;
      }
      const body = await response.text().catch(() => "");
      throw ExchangeApiError(`unexpected HTTP ${response.status}: ${body.slice(0, 200)}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("unexpected HTTP")) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        lastError = error;
        continue;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }
  const message = lastError?.message ?? "retry exhausted";
  if (message.includes("rate limited")) throw ExchangeRateLimitError(message);
  if (lastError?.name === "AbortError") throw ExchangeTimeoutError(message);
  throw ExchangeNetworkError(message);
}
