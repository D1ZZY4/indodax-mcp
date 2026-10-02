import type { z } from "zod";
import { ExchangeApiError, ValidationError } from "@indodax-mcp/errors";
import {
  OFFICIAL_PUBLIC_BUCKET,
  RateLimiter,
  type FetchFn,
  fetchWithRetry,
} from "@indodax-mcp/transport";
import { PUBLIC_BASE, PublicApi } from "./endpoints.js";
import {
  depthSchema,
  ohlcSchema,
  pairsSchema,
  serverTimeSchema,
  summariesSchema,
  tickerAllSchema,
  tickerResponseSchema,
  tradesSchema,
  type Depth,
  type OhlcBar,
  type PairInfo,
  type ServerTime,
  type TickerBody,
} from "./public-schemas.js";

export type { Depth as DepthBook, OhlcBar, PairInfo, ServerTime, TickerBody };

export interface PublicClientOptions {
  fetchFn?: FetchFn;
  rateLimitRps?: number;
}

export class PublicClient {
  private readonly fetchFn: FetchFn;
  private readonly limiter: RateLimiter;

  constructor(options: PublicClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.limiter = new RateLimiter([
      OFFICIAL_PUBLIC_BUCKET,
      ...(options.rateLimitRps !== undefined
        ? [
            {
              key: "app-throttle",
              capacity: options.rateLimitRps,
              refillPerSecond: options.rateLimitRps,
            },
          ]
        : []),
    ]);
  }

  private async get<T>(
    path: string,
    schema: z.ZodType<T>,
    query?: Record<string, string>,
  ): Promise<T> {
    await this.limiter.acquire("public-rest");
    const url = query
      ? `${PUBLIC_BASE}${path}?${new URLSearchParams(query).toString()}`
      : `${PUBLIC_BASE}${path}`;
    const response = await fetchWithRetry(url, {}, undefined, this.fetchFn);
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw ExchangeApiError(`invalid JSON from ${path}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw ValidationError(`unexpected shape from ${path}`, {
        safeMetadata: { issues: parsed.error.issues.slice(0, 3) },
      });
    }
    return parsed.data;
  }

  serverTime(): Promise<ServerTime> {
    return this.get(PublicApi.SERVER_TIME, serverTimeSchema);
  }

  pairs(): Promise<PairInfo[]> {
    return this.get(PublicApi.PAIRS, pairsSchema);
  }

  summaries(): Promise<z.infer<typeof summariesSchema>> {
    return this.get(PublicApi.SUMMARIES, summariesSchema);
  }

  ticker(pair: string): Promise<TickerBody> {
    return this.get(PublicApi.ticker(pair), tickerResponseSchema).then((body) => body.ticker);
  }

  tickerAll(): Promise<z.infer<typeof tickerAllSchema>> {
    return this.get(PublicApi.TICKER_ALL, tickerAllSchema);
  }

  trades(pair: string): Promise<z.infer<typeof tradesSchema>> {
    return this.get(PublicApi.trades(pair), tradesSchema);
  }

  depth(pair: string): Promise<Depth> {
    return this.get(PublicApi.depth(pair), depthSchema);
  }

  ohlc(symbol: string, timeframe: string, from: number, to: number): Promise<OhlcBar[]> {
    return this.get(PublicApi.OHLC_HISTORY, ohlcSchema, {
      symbol,
      tf: timeframe,
      from: String(from),
      to: String(to),
    });
  }
}
