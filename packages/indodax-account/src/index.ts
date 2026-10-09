import { z } from "zod";
import { OrderRejectedError, ValidationError } from "@indodax-mcp/errors";
import Decimal from "decimal.js";
import { asCompact, decimalOrNull, parseSymbolFlexible } from "@indodax-mcp/core";
import type { FetchFn } from "@indodax-mcp/transport";
import { OFFICIAL_V2_BUCKET, RateLimiter, fetchWithRetry } from "@indodax-mcp/transport";
import { egressHint } from "@indodax-mcp/transport/egress";
import {
  INDODAX_V2_BASE,
  translateExchangeError,
  translateReadError,
  type TapiV2Signer,
} from "@indodax-mcp/indodax-auth";
import type { Capability } from "@indodax-mcp/core";

export const V2_BASE = INDODAX_V2_BASE;

/**
 * Exchange wire spelling for a user-supplied symbol.
 *
 * Every other tool accepts any common spelling and normalizes per endpoint,
 * but these authenticated reads used to uppercase the raw input, so w3f_idr
 * went out as W3F_IDR and the exchange answered -1121 Invalid symbol.
 * Unparseable input passes through unchanged so the exchange still reports
 * genuinely unknown symbols instead of this client inventing a rejection.
 */
function exchangeSymbol(symbol: string): string {
  const parsed = parseSymbolFlexible(symbol);
  if (!parsed) return symbol;
  return asCompact(parsed);
}

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
    // Sign per attempt. The signature covers a timestamp the exchange
    // validates inside recvWindow (5000ms), so a single signature reused
    // across a retry burst would expire and turn a transient failure into a
    // permanent timestamp rejection.
    try {
      const response = await fetchWithRetry(
        `${V2_BASE}${path}`,
        { method: "GET" },
        undefined,
        this.options.fetchFn,
        () => {
          const query = signer.buildTimestampParams(params);
          return {
            url: `${V2_BASE}${path}?${query}`,
            init: { headers: { "X-APIKEY": signer.key, Sign: signer.signQuery(query) } },
          };
        },
      );
      return (await response.json()) as T;
    } catch (error) {
      // Reads keep their error code; only the message gains the exchange code,
      // the reason, and the next action, so existing callers branching on the
      // code see no change while agents stop guessing at raw transport text.
      const translated = await translateReadError(error, `GET ${path}`, egressHint);
      if (translated !== null) throw translated;
      throw error;
    }
  }

  /**
   * Read one order, naming the outcome when the exchange does not know it.
   *
   * Looking up an id the exchange has never seen, or one it has already
   * settled, is a normal answer rather than a transport fault, and the two
   * call for opposite follow-ups: confirm the position, or stop looking. The
   * raw payload distinguishes neither, so the shared vocabulary is applied
   * here rather than left for the caller to decode.
   */
  private async lookupOrder(path: string, params: Record<string, string>): Promise<unknown> {
    try {
      return await this.signedGet(path, params);
    } catch (error) {
      const translated = await translateExchangeError(error, "order lookup", egressHint);
      if (translated === null) throw error;
      throw OrderRejectedError(translated.message, {
        safeMetadata: translated.safeMetadata,
      });
    }
  }

  async openOrders(symbol?: string): Promise<unknown> {
    const params: Record<string, string> = {};
    if (symbol) params.symbol = exchangeSymbol(symbol).toUpperCase();
    return this.signedGet("/api/v2/openOrders", params);
  }

  async getOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<unknown> {
    const params: Record<string, string> = { symbol: exchangeSymbol(symbol).toUpperCase() };
    if (orderId) params.orderId = orderId;
    if (clientOrderId) params.origClientOrderId = clientOrderId;
    return this.lookupOrder("/api/v2/order", params);
  }

  async orderHistories(options: HistoryOptions): Promise<unknown> {
    return this.signedGet("/api/v2/order/histories", historyParams(options));
  }

  async myTrades(options: HistoryOptions): Promise<unknown> {
    return this.signedGet("/api/v2/myTrades", historyParams(options));
  }

  async getAccount(): Promise<AccountInfo> {
    const params: Record<string, string> = {};
    if (this.options.omitZeroBalances ?? true) params.omitZeroBalances = "true";
    // Route through signedGet so the timestamp signature is rebuilt on every
    // retry attempt inside recvWindow. A single signature reused across a
    // retry burst expires and turns a transient failure into a permanent
    // timestamp rejection.
    const json: unknown = await this.signedGet("/api/v2/account", params);
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
  // History endpoints take the lowercase compact spelling (w3fidr), while
  // order endpoints above take uppercase (W3FIDR).
  const params: Record<string, string> = { symbol: exchangeSymbol(options.symbol).toLowerCase() };
  const limit = Math.min(1000, Math.max(10, Math.floor(options.limit ?? 100)));
  params.limit = String(limit);
  if (options.startTime !== undefined) params.startTime = String(options.startTime);
  if (options.endTime !== undefined) params.endTime = String(options.endTime);
  return params;
}
