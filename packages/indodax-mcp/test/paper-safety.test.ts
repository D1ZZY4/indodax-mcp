import { describe, expect, it, vi } from "vitest";
import Decimal from "decimal.js";
import { loadEnv } from "@indodax-mcp/config";
import { ExecutionService } from "@indodax-mcp/indodax-execution";
import type { RiskDecision } from "@indodax-mcp/core";
import { PaperExecutor, currentUtcDay } from "@indodax-mcp/indodax-paper";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { createApp } from "../src/composition.js";
import { placePaperOrder } from "../src/tools/paper.js";
import { resolveRiskContext } from "../src/risk-context.js";

const allow: RiskDecision = { outcome: "ALLOW", reasons: [], message: "allowed" };

function orderShape(overrides: Record<string, unknown> = {}) {
  return {
    internalOrderId: "o1",
    clientOrderId: "c1",
    exchangeOrderId: null,
    symbol: { base: "btc", quote: "idr" },
    side: "BUY",
    orderType: "LIMIT",
    price: "1000",
    quantity: "1",
    remaining: "1",
    state: "NEW",
    environment: "paper",
    tenantId: "t1",
    exchangeAccountId: "a1",
    strategyId: null,
    runId: null,
    riskDecisionId: null,
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Parameters<ExecutionService<PaperExecutor>["execute"]>[0]["order"];
}

function executionRequest(order: ReturnType<typeof orderShape>) {
  return {
    order,
    mode: "paper",
    capability: "PAPER",
    correlationId: "corr-1",
    requestedAt: new Date().toISOString(),
  } as Parameters<ExecutionService<PaperExecutor>["execute"]>[0];
}

describe("paper safety", () => {
  it("halts placement while deadman is stale or expired", async () => {
    const app = createApp(loadEnv({}));
    app.deadman.arm(["btc_idr"], 120_000);
    app.deadman.recordRefreshFailure();
    await expect(
      placePaperOrder(app, { pair: "btc_idr", side: "BUY", price: 1000, quantity: 100 }),
    ).rejects.toThrow(/deadman/i);
  });

  it("tracks realized pnl with average-cost basis including fees", async () => {
    const executor = new PaperExecutor();
    const service = new ExecutionService(executor);
    await service.execute(executionRequest(orderShape()), allow);
    executor.fill("o1", "1000");
    const sell = orderShape({
      internalOrderId: "o2",
      clientOrderId: "c2",
      side: "SELL",
      price: "1200",
    });
    await service.execute(executionRequest(sell), allow);
    executor.fill("o2", "1200");

    const buyFee = new Decimal(1000).mul("0.0026");
    const sellFee = new Decimal(1200).mul("0.0026");
    const expected = new Decimal(1200).minus(sellFee).minus(new Decimal(1000).plus(buyFee));
    const app = createApp(loadEnv({}));
    app.paper = executor;
    const context = await resolveRiskContext(app, { mode: "paper", capability: "PAPER" });
    expect(context.dailyPnl?.toString()).toBe(expected.toString());
    expect(context.tradeCount).toBe(2);
  });

  it("restores snapshots persisted before cost-basis tracking", () => {
    const executor = new PaperExecutor();
    executor.restore({
      balances: { idr: "100000000", btc: "1" },
      orders: [],
      nextOrderId: 1,
      tradeCount: 0,
      totalFees: "0",
      initialBalances: { idr: "100000000", btc: "1" },
    });
    expect(executor.snapshot().costBasis).toEqual({});
    expect(executor.snapshot().realizedByDay).toEqual({});
  });

  it("attributes no gain to quantities without tracked basis", async () => {
    const executor = new PaperExecutor();
    executor.topup("xyz", "10");
    const service = new ExecutionService(executor);
    const sell = orderShape({
      internalOrderId: "s1",
      clientOrderId: "cs1",
      symbol: { base: "xyz", quote: "idr" },
      side: "SELL",
      price: "100",
      quantity: "4",
      remaining: "4",
    });
    await service.execute(executionRequest(sell), allow);
    executor.fill("s1", "100");
    const day = currentUtcDay();
    expect(executor.snapshot().realizedByDay[day] ?? "0").toBe("0");
    expect(executor.snapshot().balances.idr).toBe("100000398.96");
  });

  it("marks open positions to live prices for daily pnl", async () => {
    const app = createApp(loadEnv({}));
    app.publicClient = {
      ticker: async () => ({ high: "1300", low: "1300", last: "1300", buy: "1300", sell: "1300" }),
    } as unknown as PublicClient;
    const executor = new PaperExecutor();
    const service = new ExecutionService(executor);
    await service.execute(executionRequest(orderShape()), allow);
    executor.fill("o1", "1000");
    const second = orderShape({ internalOrderId: "o2", clientOrderId: "c2" });
    await service.execute(executionRequest(second), allow);
    app.paper = executor;
    const context = await resolveRiskContext(app, {
      mode: "paper",
      capability: "PAPER",
      pair: "wxx_idr",
    });
    // Basis 1002.6 on 1 unit, mark 1300 on the open unit, nothing realized today.
    expect(context.dailyPnl?.toString()).toBe("297.4");
  });

  it("treats market data as stale after going offline", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const app = createApp(loadEnv({}));
      const live = {
        ticker: async () => ({ high: "1", low: "1", last: "100", buy: "100", sell: "100" }),
      } as unknown as PublicClient;
      const dead = {
        ticker: async () => {
          throw new Error("offline");
        },
      } as unknown as PublicClient;
      app.publicClient = live;
      const fresh = await resolveRiskContext(app, {
        mode: "paper",
        capability: "PAPER",
        pair: "qzx_idr",
      });
      expect(fresh.marketAgeMs).toBe(0);
      app.publicClient = dead;
      vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
      const stale = await resolveRiskContext(app, {
        mode: "paper",
        capability: "PAPER",
        pair: "qzx_idr",
      });
      expect(stale.marketAgeMs).toBeGreaterThan(60000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects MARKET paper orders with a clear simulation message", async () => {
    const app = createApp(loadEnv({}));
    await expect(
      placePaperOrder(app, {
        pair: "btc_idr",
        side: "BUY",
        orderType: "MARKET",
        quantity: 1,
      }),
    ).rejects.toThrow(/MARKET is not supported in simulation/i);
  });
});
