import { describe, expect, it } from "vitest";
import { OrderRejectedError } from "@indodax-mcp/errors";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { evaluateStops } from "@indodax-mcp/indodax-mcp/tools/stop";
import { isLiquidityBlock } from "@indodax-mcp/indodax-mcp/stop-classification";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

const TP_ORDER = {
  symbol: "HONEYIDR",
  orderId: 968628,
  clientOrderId: "honey-tp-001",
  side: "SELL",
  price: "53",
  origQty: "300",
  executedQty: "0",
  status: "NEW",
};

/**
 * A composed live server whose only HONEY balance is reserved by the
 * take-profit, which is the exact condition that produced repeated -2010 and
 * left a position with no working cut-loss.
 */
function buildLiveServer(last: string, accountFails = false) {
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
  built.app.publicClient = {
    ticker: async () => ({ high: last, low: last, last, buy: last, sell: last }),
    pairs: async () => [],
  } as unknown as PublicClient;
  built.app.accountClient = {
    getAccount: async () => {
      if (accountFails) throw new Error("exchange unreachable");
      return {
        canTrade: true,
        canWithdraw: false,
        balances: [
          { asset: "HONEY", free: "0", locked: "300" },
          { asset: "IDR", free: "1000000", locked: "0" },
        ],
      };
    },
    openOrders: async () => [TP_ORDER],
  } as unknown as NonNullable<AppServices["accountClient"]>;
  /**
   * A live stop places through the live executor, so that is where the
   * exchange refusal has to be modelled. Overriding the paper ledger would
   * exercise nothing.
   */
  const live = built.app.liveExecutor;
  if (live === null) throw new Error("live executor requires credentials");
  return { built, live };
}

describe("isLiquidityBlock", () => {
  it("recognises an exchange insufficient-balance rejection", () => {
    expect(isLiquidityBlock("exchange rejected order with code -2010: insufficient balance")).toBe(
      true,
    );
    expect(
      isLiquidityBlock('unexpected HTTP 400: {"code":-2010,"msg":"Insufficient balance"}'),
    ).toBe(true);
    expect(isLiquidityBlock("denied: INSUFFICIENT_BALANCE. next: ...")).toBe(true);
  });

  it("does not treat other refusals as a liquidity block", () => {
    expect(isLiquidityBlock("denied: MIN_ORDER_SIZE")).toBe(false);
    expect(isLiquidityBlock("exchange rejected cancel with code -2013")).toBe(false);
    expect(isLiquidityBlock("denied: COOLDOWN_ACTIVE")).toBe(false);
  });
});

/**
 * A stop refused for a locked quantity used to be marked `failed`, which
 * retired it permanently. That is the worst outcome for protection: the stop
 * disappeared from the active list while the position stayed exposed.
 */
describe("stop blocked on locked balance", () => {
  it("stays armed and retryable instead of failing permanently", async () => {
    const { built, live } = buildLiveServer("45");
    live.submit = async () => {
      throw OrderRejectedError(
        "exchange rejected order with code -2010: insufficient balance. next: call indodax_balances",
      );
    };
    built.app.stops.add({
      pair: "honey_idr",
      side: "SELL",
      quantity: 300,
      stopPrice: 46,
      limitPrice: 46,
      mode: "live",
      acknowledgedAt: new Date().toISOString(),
    });

    const result = await evaluateStops(built.app);
    const entry = result.fired.at(0);
    expect(entry?.status).toBe("blocked");
    expect(entry?.retryable).toBe(true);
    // The remedy names the reservation, so the caller is not left guessing.
    expect(entry?.fix).toContain("honey-tp-001");

    const stop = built.app.stops.list(true).at(0);
    expect(stop?.status).toBe("blocked");
    expect(stop?.blockedFix).toBeTruthy();
    // Still counted as active protection, which is the whole point.
    expect(built.app.stops.list().map((s) => s.id)).toEqual([stop?.id]);
  });

  it("surfaces the block through indodax_stop_check instead of a silent failure", async () => {
    const { built, live } = buildLiveServer("45");
    live.submit = async () => {
      throw OrderRejectedError(
        "exchange rejected order with code -2010: insufficient balance. next: call indodax_balances",
      );
    };
    built.app.stops.add({
      pair: "honey_idr",
      side: "SELL",
      quantity: 300,
      stopPrice: 46,
      limitPrice: 46,
      mode: "live",
      acknowledgedAt: new Date().toISOString(),
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_stop_check",
        arguments: {},
      })) as { content: { type: string; text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (
        JSON.parse(result.content[0]?.text ?? "{}") as {
          data: { fired: { status: string; retryable?: boolean; fix?: string }[] };
        }
      ).data;
      expect(data.fired.at(0)?.status).toBe("blocked");
      expect(data.fired.at(0)?.retryable).toBe(true);
      expect(data.fired.at(0)?.fix).toContain("honey-tp-001");
    } finally {
      await harness.close();
    }
  });

  it("still marks a non-liquidity refusal as a terminal failure", async () => {
    const { built, live } = buildLiveServer("45");
    live.submit = async () => {
      throw OrderRejectedError("exchange rejected order with code -2013: order does not exist");
    };
    built.app.stops.add({
      pair: "honey_idr",
      side: "SELL",
      quantity: 300,
      stopPrice: 46,
      limitPrice: 46,
      mode: "live",
      acknowledgedAt: new Date().toISOString(),
    });
    const result = await evaluateStops(built.app);
    expect(result.fired.at(0)?.status).toBe("failed");
    expect(built.app.stops.list(true).at(0)?.status).toBe("failed");
  });
});

describe("stop evaluation refreshes the account", () => {
  it("reads live balances before evaluating a live stop", async () => {
    // Without the refresh the autopoll evaluated on a snapshot that had never
    // been read and denied every live trigger with STALE_ACCOUNT_STATE.
    const { built } = buildLiveServer("100");
    built.app.stops.add({
      pair: "honey_idr",
      side: "SELL",
      quantity: 300,
      stopPrice: 90,
      limitPrice: 90,
      mode: "live",
      acknowledgedAt: new Date().toISOString(),
    });
    expect(built.app.accountSyncedAt).toBeNull();
    await evaluateStops(built.app);
    expect(built.app.accountSyncedAt).not.toBeNull();
  });

  it("leaves the snapshot unrefreshed when the read fails, so the engine still applies its rule", async () => {
    // A failed refresh must never be recorded as a successful sync: that would
    // make a stale account look fresh and let live placement through on a
    // balance nobody has verified.
    const { built, live } = buildLiveServer("10", true);
    live.submit = async () => {
      throw OrderRejectedError("exchange rejected order with code -2013: order does not exist");
    };
    built.app.stops.add({
      pair: "btc_idr",
      side: "SELL",
      quantity: 0.01,
      stopPrice: 100,
      limitPrice: 100,
      mode: "live",
      acknowledgedAt: new Date().toISOString(),
    });
    await evaluateStops(built.app);
    expect(built.app.accountSyncedAt).toBeNull();
  });
});
