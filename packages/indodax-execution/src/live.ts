import { OrderRejectedError, ValidationError } from "@indodax-mcp/errors";
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
 * Exchange rejections arrive as raw codes plus terse text (for example
 * code -2010 for insufficient balance). Keep the raw payload for
 * traceability, but translate the known-terse cases into the next action
 * so agents do not have to guess which balance or order is short.
 */
function rejectionMessage(action: string, raw: Record<string, unknown>): string {
  const text = JSON.stringify(raw).slice(0, 200);
  if (/insufficient/i.test(text) && /balance|fund/i.test(text)) {
    return (
      `exchange rejected ${action}: insufficient balance (${text}). ` +
      "next: check indodax_balances for free funds versus amounts locked in open orders, " +
      "then lower the size or free funds before retrying"
    );
  }
  return `exchange rejected ${action}: ${text}`;
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
    const raw = await this.signed<Record<string, unknown>>("POST", "/api/v2/order", params);
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
    const raw = await this.signed<Record<string, unknown>>("DELETE", "/api/v2/order", params);
    const code = (raw as { code?: number }).code;
    if (typeof code === "number" && code !== 0) {
      throw OrderRejectedError(rejectionMessage("cancel", raw));
    }
    return true;
  }
}
