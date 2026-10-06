import { OrderRejectedError, ValidationError, isAppError } from "@indodax-mcp/errors";
import { asCompact, parseSymbolFlexible } from "@indodax-mcp/core";
import { INDODAX_V2_BASE, type TapiV2Signer } from "@indodax-mcp/indodax-auth";
import {
  OFFICIAL_V2_BUCKET,
  RateLimiter,
  fetchWithRetry,
  type FetchFn,
} from "@indodax-mcp/transport";
import type {
  ExecutionBackend,
  ExecutionRequest,
  ExecutionResult,
} from "@indodax-mcp/indodax-execution";

const V2_BASE = INDODAX_V2_BASE;

/**
 * Verified exchange rejection codes and the action that resolves them.
 *
 * Only codes observed against the live API belong here. An unknown code falls
 * through to the message text rather than being guessed at, because a wrong
 * remedy sends an agent down the wrong path and costs real money.
 */
const REJECTION_REMEDIES: Readonly<Record<number, string>> = {
  [-2010]:
    "insufficient balance. next: call indodax_balances and compare free funds against " +
    "the amount locked by open orders, then lower the size or free funds before retrying",
  [-2015]:
    "unauthorized IP address. next: add this server's public IP to the API key allowlist " +
    "in the exchange dashboard, or use a key without IP restrictions; the request signature " +
    "was accepted, so this is not a credentials or signing problem",
  [-1021]:
    "invalid client order id. next: generate a fresh clientOrderId, because an id already " +
    "used on the exchange is rejected even when the previous order is gone",
};

interface ExchangePayload {
  code?: number;
  msg?: string;
}

/**
 * Read the exchange error payload out of a transport failure.
 *
 * The exchange signals a business rejection with HTTP 4xx, so the retry helper
 * throws before the executor sees a body. The payload is recovered from the
 * error metadata instead of the message so the translation sees the real code.
 */
function exchangePayloadFrom(error: unknown): ExchangePayload | null {
  if (!isAppError(error)) return null;
  const body = error.safeMetadata?.body;
  if (typeof body !== "string" || body === "") return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === "object" && parsed !== null) return parsed as ExchangePayload;
  } catch {
    // A non-JSON body carries no code; the caller keeps the transport error.
  }
  return null;
}

/**
 * Exchange rejections arrive as raw codes plus terse text (for example
 * code -2010 for insufficient balance). Keep the raw payload for
 * traceability, but translate the known-terse cases into the next action
 * so agents do not have to guess which balance or order is short.
 */
function rejectionMessage(action: string, raw: ExchangePayload): string {
  const code = typeof raw.code === "number" ? raw.code : null;
  const text = (raw.msg ?? JSON.stringify(raw)).slice(0, 200);
  const remedy = code === null ? undefined : REJECTION_REMEDIES[code];
  if (remedy !== undefined) {
    const prefix = `exchange rejected ${action}`;
    return code === null
      ? `${prefix}: ${remedy} (${text})`
      : `${prefix} with code ${code}: ${remedy} (${text})`;
  }
  const text2 = JSON.stringify(raw).slice(0, 200);
  if (/insufficient/i.test(text2) && /balance|fund/i.test(text2)) {
    return (
      `exchange rejected ${action}: insufficient balance (${text2}). ` +
      "next: check indodax_balances for free funds versus amounts locked in open orders, " +
      "then lower the size or free funds before retrying"
    );
  }
  const detail = code === null ? text2 : `code ${code}: ${text2}`;
  return (
    `exchange rejected ${action}: ${detail}. ` +
    "next: treat this as an exchange rejection; inspect indodax_open_orders and indodax_account " +
    "for state, and do not retry the same request unchanged"
  );
}

export interface LiveExecutorOptions {
  signer: TapiV2Signer;
  fetchFn?: FetchFn;
  limiter?: RateLimiter | undefined;
}

export class LiveExecutor implements ExecutionBackend {
  readonly name = "live";
  private readonly limiter: RateLimiter;

  constructor(private readonly options: LiveExecutorOptions) {
    this.limiter = options.limiter ?? new RateLimiter([OFFICIAL_V2_BUCKET]);
  }

  private async signed<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    await this.limiter.acquire("v2-rest");
    // Sign per attempt so a retry carries a timestamp inside recvWindow
    // instead of replaying an expired signature.
    const response = await fetchWithRetry(
      `${V2_BASE}${path}`,
      { method },
      undefined,
      this.options.fetchFn,
      () => {
        const query = this.options.signer.buildTimestampParams(params);
        const headers = {
          "X-APIKEY": this.options.signer.key,
          Sign: this.options.signer.signQuery(query),
          "Content-Type": "application/x-www-form-urlencoded",
        };
        // GET and DELETE carry parameters in the query string; POST sends a
        // form-encoded body, matching the documented v2 contract.
        return method === "GET" || method === "DELETE"
          ? { url: `${V2_BASE}${path}?${query}`, init: { method, headers } }
          : { url: `${V2_BASE}${path}`, init: { method, headers, body: query } };
      },
    );
    const json: unknown = await response.json();
    return json as T;
  }

  async submit(request: ExecutionRequest): Promise<ExecutionResult> {
    const order = request.order;
    if (order.orderType !== "LIMIT" && order.orderType !== "MARKET") {
      throw ValidationError(`unsupported order type ${order.orderType}`);
    }
    const params: Record<string, string> = {
      symbol: `${order.symbol.base}${order.symbol.quote}`.toUpperCase(),
      side: order.side,
      type: order.orderType,
    };
    if (order.orderType === "LIMIT") {
      if (!order.price) throw ValidationError("price required for LIMIT order");
      params.price = order.price;
    }
    if (order.side === "BUY" && order.orderType === "MARKET") {
      params.quoteOrderQty = order.quantity;
    } else {
      params.quantity = order.quantity;
    }
    params.newClientOrderId = order.clientOrderId;
    if (order.timeInForce !== undefined) params.timeInForce = order.timeInForce;
    if (order.stpMode !== undefined) params.selfTradePreventionMode = order.stpMode;
    let raw: Record<string, unknown>;
    try {
      raw = await this.signed<Record<string, unknown>>("POST", "/api/v2/order", params);
    } catch (error) {
      // A rejection arrives as HTTP 4xx, so the retry helper throws first.
      // Recover the exchange payload here, otherwise the rejection reaches the
      // caller as a bare transport string with no code and no next action.
      const payload = exchangePayloadFrom(error);
      if (payload !== null) throw OrderRejectedError(rejectionMessage("order", payload));
      throw error;
    }
    const code = (raw as { code?: number }).code;
    if (typeof code === "number" && code !== 0) {
      throw OrderRejectedError(rejectionMessage("order", raw));
    }
    const body = (raw as { data?: Record<string, unknown> }).data ?? raw;
    return {
      internalOrderId: order.internalOrderId,
      exchangeOrderId: String(body.orderId ?? body.fullOrderId ?? ""),
      accepted: true,
      message: "submitted to exchange",
      executedAt: new Date().toISOString(),
    };
  }

  async cancel(internalOrderId: string): Promise<boolean> {
    void internalOrderId;
    throw ValidationError("live cancel needs exchange order id plus symbol; use cancelOrder tool");
  }

  async cancelByExchangeId(
    symbol: string,
    orderId?: string,
    clientOrderId?: string,
  ): Promise<boolean> {
    if (!orderId && !clientOrderId) {
      throw ValidationError("cancel needs exchange orderId or clientOrderId plus symbol");
    }
    // Exchange symbols are uppercase compact (BTCIDR). Submit and account
    // reads normalize; cancel must match so any common spelling cancels.
    const parsed = parseSymbolFlexible(symbol);
    if (!parsed) throw ValidationError(`invalid symbol: ${symbol}`);
    const params: Record<string, string> = { symbol: asCompact(parsed).toUpperCase() };
    if (orderId) params.orderId = orderId;
    else if (clientOrderId) params.origClientOrderId = clientOrderId;
    let raw: Record<string, unknown>;
    try {
      raw = await this.signed<Record<string, unknown>>("DELETE", "/api/v2/order", params);
    } catch (error) {
      const payload = exchangePayloadFrom(error);
      if (payload !== null) throw OrderRejectedError(rejectionMessage("cancel", payload));
      throw error;
    }
    const code = (raw as { code?: number }).code;
    if (typeof code === "number" && code !== 0) {
      throw OrderRejectedError(rejectionMessage("cancel", raw));
    }
    return true;
  }
}
