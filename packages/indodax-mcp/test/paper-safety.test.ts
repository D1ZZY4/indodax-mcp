import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { loadEnv } from "@indodax-mcp/config";
import { ExecutionService } from "@indodax-mcp/indodax-execution";
import type { RiskDecision } from "@indodax-mcp/core";
import { PaperExecutor } from "@indodax-mcp/indodax-paper";
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
});
