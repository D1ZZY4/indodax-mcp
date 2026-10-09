/**
 * Deterministic regression for the stop failure classification defect.
 *
 * A stop is retired permanently when its trigger placement is refused. A
 * refusal caused by stale local context is refreshable, so classifying it as
 * terminal removes armed protection from a still-open position.
 */
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  createRiskEngine,
  defaultRiskLimits,
  liveEnabledPolicy,
} from "@d1zzy4-jethools/indodax-risk";
import { evaluateStops } from "@d1zzy4-jethools/mcp-app/tools/stop";
import {
  isLiquidityBlock,
  isRetryableStopFailure,
} from "@d1zzy4-jethools/mcp-app/stop-classification";
import { loadEnv } from "@d1zzy4-jethools/config";
import type { PublicClient } from "@d1zzy4-jethools/indodax-client";
import { clearCache } from "@d1zzy4-jethools/indodax-market";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";
import type { AppServices } from "@d1zzy4-jethools/mcp-app/composition";

const engine = createRiskEngine(defaultRiskLimits(), liveEnabledPolicy());

function decisionMessage(context: Record<string, unknown>): string {
  const decision = engine.evaluate(
    {
      notional: new Decimal(100000),
      quantity: new Decimal(1),
      price: new Decimal(100000),
      isMarket: false,
      symbol: "btc_idr",
    },
    {
      mode: "live",
      capability: "TRADE",
      marketAgeMs: 1_000,
      accountAgeMs: 1_000,
      dailyPnl: new Decimal(0),
      tradeCount: 0,
      duplicate: false,
      reconciliationHalted: false,
      deadmanUnknown: false,
      balanceSufficient: true,
      ...context,
    } as never,
  );
  return `denied: ${decision.reasons.join(", ")}. next: x`;
}

describe("stop failure classification", () => {
  it("treats a stale-context denial as retryable regardless of reason order", () => {
    // The risk engine joins every failed rule into one message, so a stale
    // context denial can appear after another reason. Anchoring the match to
    // the first reason retired a live stop whose only problem was staleness.
    const staleAlone = decisionMessage({ accountAgeMs: 999_999_999 });
    expect(staleAlone).toContain("STALE_ACCOUNT_STATE");
    expect(isRetryableStopFailure(staleAlone)).toBe(true);

    const afterDuplicate = decisionMessage({
      duplicate: true,
      accountAgeMs: 999_999_999,
    });
    expect(afterDuplicate).toContain("STALE_ACCOUNT_STATE");
    expect(isRetryableStopFailure(afterDuplicate)).toBe(true);

    const afterSuspension = decisionMessage({
      marketSuspended: true,
      accountAgeMs: 999_999_999,
    });
    expect(afterSuspension).toContain("STALE_ACCOUNT_STATE");
    expect(isRetryableStopFailure(afterSuspension)).toBe(true);

    const staleMarketAfterCooldown = decisionMessage({
      marketAgeMs: 999_999_999,
      lastOrderAtMs: Date.now(),
    });
    expect(staleMarketAfterCooldown).toContain("STALE_MARKET_DATA");
    expect(isRetryableStopFailure(staleMarketAfterCooldown)).toBe(true);
  });

  it("still treats a terminal refusal as terminal", () => {
    expect(isRetryableStopFailure(decisionMessage({ balanceSufficient: true }))).toBe(false);
    expect(isRetryableStopFailure("denied: MIN_ORDER_SIZE. next: x")).toBe(false);
    expect(isRetryableStopFailure("exchange rejected order with code -2013")).toBe(false);
  });

  it("keeps a reserved-quantity refusal classified as a block, not a stale retry", () => {
    // INSUFFICIENT_BALANCE and a stale context can co-occur. The liquidity
    // assessment carries the actionable remedy, so it must still be found.
    const message = decisionMessage({ accountAgeMs: 999_999_999, balanceSufficient: false });
    expect(message).toContain("INSUFFICIENT_BALANCE");
    expect(isLiquidityBlock(message)).toBe(true);
  });

  it("leaves a stop armed when its placement is refused for stale context", async () => {
    clearCache();
    const built = buildIndodaxServer(
      loadEnv({
        APP_ENV: "live",
        TRADE_ENABLED: "true",
        INDODAX_API_KEY: "k",
        INDODAX_API_SECRET: "s",
      }),
    );
    built.app.scheduler.stopAll();
    // Prices above the notional floor so the stop clears MIN_ORDER_SIZE and
    // reaches the executor. The refusal under test is modelled on the
    // executor because that is where a transport or exchange answer becomes a
    // classification decision.
    const last = "8900000000";
    built.app.publicClient = {
      ticker: async () => ({ high: last, low: last, last, buy: last, sell: last }),
      pairs: async () => [],
    } as unknown as PublicClient;
    built.app.accountClient = {
      getAccount: async () => ({
        canTrade: true,
        canWithdraw: false,
        balances: [{ asset: "BTC", free: "10", locked: "0" }],
      }),
      openOrders: async () => [],
    } as unknown as NonNullable<AppServices["accountClient"]>;
    const live = built.app.liveExecutor;
    if (live === null) throw new Error("live executor requires credentials");
    live.submit = async () => {
      // A stale-context denial arriving after another rule fired, which is the
      // ordering that previously retired the stop.
      throw new Error("denied: DUPLICATE_ORDER, STALE_MARKET_DATA. next: retry");
    };
    built.app.stops.add({
      pair: "btc_idr",
      side: "SELL",
      quantity: 0.00001,
      stopPrice: 9000000000,
      limitPrice: 9000000000,
      mode: "live",
      acknowledgedAt: new Date().toISOString(),
    });

    const result = await evaluateStops(built.app);
    const entry = result.fired.at(0);
    expect(entry?.status).toBe("retry");
    expect(entry?.retryable).toBe(true);
    expect(built.app.stops.list().map((stop) => stop.id)).toEqual(["stop-1"]);
    expect(built.app.stops.list(true).at(0)?.status).toBe("open");
  });
});
