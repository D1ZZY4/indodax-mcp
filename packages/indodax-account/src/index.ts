import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import Decimal from "decimal.js";
import { decimalOrNull } from "@indodax-mcp/core";
import type { FetchFn } from "@indodax-mcp/transport";
import { OFFICIAL_V2_BUCKET, RateLimiter, fetchWithRetry } from "@indodax-mcp/transport";
import type { TapiV2Signer } from "@indodax-mcp/indodax-auth";
import type { Capability } from "@indodax-mcp/core";

export const V2_BASE = "https://api.indodax.com";

const balanceSchema = z.object({
  asset: z.string(),
  free: z.string(),
  locked: z.string(),
});

const accountSchema = z.object({
  canTrade: z.boolean(),
  canWithdraw: z.boolean(),
  accountType: z.string().optional(),
  balances: z.array(balanceSchema),
  uid: z.union([z.string(), z.number()]).optional(),
});

export type AccountInfo = z.infer<typeof accountSchema>;

export interface BalanceView {
  asset: string;
  free: string;
  locked: string;
  total: string;
}

export function toBalanceViews(account: AccountInfo): BalanceView[] {
  return account.balances.map((balance) => {
    const free = decimalOrNull(balance.free) ?? new Decimal("0");
    const locked = decimalOrNull(balance.locked) ?? new Decimal("0");
    return {
      asset: balance.asset.toLowerCase(),
      free: balance.free,
      locked: balance.locked,
      total: free.plus(locked).toString(),
    };
  });
}

export function capabilitiesFor(account: AccountInfo): Capability[] {
  const capabilities: Capability[] = ["READ", "PAPER"];
  if (account.canTrade) capabilities.push("TRADE");
  if (account.canWithdraw) capabilities.push("WITHDRAW");
  return capabilities;
}

export interface AccountClientOptions {
  signer: TapiV2Signer;
  fetchFn?: FetchFn;
  omitZeroBalances?: boolean;
  limiter?: RateLimiter | undefined;
}

export interface HistoryOptions {
  symbol: string;
  limit?: number | undefined;
  startTime?: number | undefined;
  endTime?: number | undefined;
}

export class AccountClient {
  private readonly limiter: RateLimiter;

  constructor(private readonly options: AccountClientOptions) {
    this.limiter = options.limiter ?? new RateLimiter([OFFICIAL_V2_BUCKET]);
  }

  private async signedGet<T>(path: string, params: Record<string, string>): Promise<T> {
    await this.limiter.acquire("v2-rest");
    const signer = this.options.signer;
    const query = signer.buildTimestampParams(params);
    const signature = signer.signQuery(query);
    const url = `${V2_BASE}${path}?${query}`;
    const response = await fetchWithRetry(
      url,
      { headers: { "X-APIKEY": signer.key, Sign: signature } },
      undefined,
      this.options.fetchFn,
    );
    return (await response.json()) as T;
  }

  async openOrders(symbol?: string): Promise<unknown> {
    const params: Record<string, string> = {};
    if (symbol) params.symbol = symbol.toUpperCase();
    return this.signedGet("/api/v2/openOrders", params);
  }

  async getOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<unknown> {
    const params: Record<string, string> = { symbol: symbol.toUpperCase() };
    if (orderId) params.orderId = orderId;
    if (clientOrderId) params.origClientOrderId = clientOrderId;
    return this.signedGet("/api/v2/order", params);
  }

  async orderHistories(options: HistoryOptions): Promise<unknown> {
    return this.signedGet("/api/v2/order/histories", historyParams(options));
  }

  async myTrades(options: HistoryOptions): Promise<unknown> {
    return this.signedGet("/api/v2/myTrades", historyParams(options));
  }

  async getAccount(): Promise<AccountInfo> {
    await this.limiter.acquire("v2-rest");
    const params: Record<string, string> = {};
    if (this.options.omitZeroBalances ?? true) params.omitZeroBalances = "true";
    const query = this.options.signer.buildTimestampParams(params);
    const signature = this.options.signer.signQuery(query);
    const url = `${V2_BASE}/api/v2/account?${query}`;
    const response = await fetchWithRetry(
      url,
      { headers: { "X-APIKEY": this.options.signer.key, Sign: signature } },
      undefined,
      this.options.fetchFn,
    );
    const json: unknown = await response.json();
    const parsed = accountSchema.safeParse(json);
    if (!parsed.success) {
      throw ValidationError("unexpected account shape", {
        safeMetadata: { issues: parsed.error.issues.slice(0, 3) },
      });
    }
    return parsed.data;
  }
}

function historyParams(options: HistoryOptions): Record<string, string> {
  const params: Record<string, string> = { symbol: options.symbol.toLowerCase() };
  const limit = Math.min(1000, Math.max(10, Math.floor(options.limit ?? 100)));
  params.limit = String(limit);
  if (options.startTime !== undefined) params.startTime = String(options.startTime);
  if (options.endTime !== undefined) params.endTime = String(options.endTime);
  return params;
}
