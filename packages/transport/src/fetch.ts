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
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 500,
  timeoutMs: 30_000,
};

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function backoffDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** (attempt - 1);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  fetchFn: FetchFn = fetch,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
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
