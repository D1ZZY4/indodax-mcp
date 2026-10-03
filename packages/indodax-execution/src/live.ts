import { OrderRejectedError, ValidationError } from "@indodax-mcp/errors";
import { INDODAX_V2_BASE, type TapiV2Signer } from "@indodax-mcp/indodax-auth";
import {
  OFFICIAL_V2_BUCKET,
  RateLimiter,
  fetchWithRetry,
  type FetchFn,
} from "@indodax-mcp/transport";
import type { ExecutionBackend, ExecutionRequest, ExecutionResult } from "./index.js";

const V2_BASE = INDODAX_V2_BASE;

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
    const query = this.options.signer.buildTimestampParams(params);
    const signature = this.options.signer.signQuery(query);
    const headers = {
      "X-APIKEY": this.options.signer.key,
      Sign: signature,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const url = `${V2_BASE}${path}`;
    const init: RequestInit =
      method === "GET" || method === "DELETE"
        ? { method, headers }
        : { method, headers, body: query };
    const target = method === "GET" || method === "DELETE" ? `${url}?${query}` : url;
    const response = await fetchWithRetry(target, init, undefined, this.options.fetchFn);
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
      throw OrderRejectedError(`exchange rejected order: ${JSON.stringify(raw).slice(0, 200)}`);
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
    const params: Record<string, string> = { symbol };
    if (orderId) params.orderId = orderId;
    else if (clientOrderId) params.origClientOrderId = clientOrderId;
    const raw = await this.signed<Record<string, unknown>>("DELETE", "/api/v2/order", params);
    const code = (raw as { code?: number }).code;
    if (typeof code === "number" && code !== 0) {
      throw OrderRejectedError(`exchange rejected cancel: ${JSON.stringify(raw).slice(0, 200)}`);
    }
    return true;
  }
}
