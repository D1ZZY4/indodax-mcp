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

/**
 * Builds the request for one attempt.
 *
 * Signed exchange requests must re-sign per attempt: the signature covers a
 * timestamp that the exchange validates inside `recvWindow`, so reusing one
 * signature across retries silently produces timestamp failures once the
 * window has passed. The signed payload can live in the URL, the body, or the
 * headers, so the hook returns both and callers rebuild whichever they signed.
 */
export type BuildRequest = (attempt: number) => { url: string; init: RequestInit };

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

/** Release an unread body so the socket can be reused instead of pinned open. */
function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => {
    // Body already consumed or unsupported; nothing further to release.
  });
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  fetchFn: FetchFn = fetch,
  buildRequest?: BuildRequest,
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
      const built = buildRequest ? buildRequest(attempt) : { url, init };
      const response = await fetchFn(built.url, {
        ...built.init,
        signal: controller.signal,
      });
      if (response.ok) return response;
      if (response.status === 429) {
        discardBody(response);
        lastError = new Error(`rate limited (HTTP ${response.status})`);
        continue;
      }
      if (isRetryableStatus(response.status)) {
        discardBody(response);
        lastError = new Error(`server error (HTTP ${response.status})`);
        continue;
      }
      const body = await response.text().catch(() => "");
      // Carry the status and the raw body so an adapter can tell a business
      // rejection from a transport fault. The exchange answers order and
      // cancel rejections with HTTP 4xx plus a JSON error code, so the message
      // text alone leaves the caller unable to name the cause or the next
      // action. safeMetadata keeps the payload available without changing the
      // message that existing callers and logs already match on.
      throw ExchangeApiError(`unexpected HTTP ${response.status}: ${body.slice(0, 200)}`, {
        safeMetadata: { status: response.status, body: body.slice(0, 2000) },
      });
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
