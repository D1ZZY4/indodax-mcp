import { describe, expect, it } from "vitest";
import { ExecutionService } from "@d1zzy4-jethools/indodax-execution";
import type { RiskDecision } from "@d1zzy4-jethools/core";
import { PaperExecutor } from "@d1zzy4-jethools/indodax-paper";

function paperRequest(overrides: Record<string, unknown> = {}) {
  return {
    order: {
      internalOrderId: "o1",
      clientOrderId: "c1",
      exchangeOrderId: null,
      symbol: { base: "btc", quote: "idr" },
      side: "BUY",
      orderType: "LIMIT",
      price: "1000",
      quantity: "1",
      remaining: "1",
      state: "ACCEPTED",
      environment: "paper",
      tenantId: "t1",
      exchangeAccountId: "a1",
      strategyId: null,
      runId: null,
      riskDecisionId: null,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    mode: "paper",
    capability: "PAPER",
    correlationId: "corr-1",
    requestedAt: new Date().toISOString(),
    ...overrides,
  } as Parameters<ExecutionService<PaperExecutor>["execute"]>[0];
}

const allow: RiskDecision = { outcome: "ALLOW", reasons: [], message: "allowed" };

describe("paper executor", () => {
  it("opens buys through the execution service", async () => {
    const executor = new PaperExecutor();
    const service = new ExecutionService(executor);
    const result = await service.execute(paperRequest(), allow);
    expect(result.accepted).toBe(true);
    expect(executor.openOrders()).toHaveLength(1);
    expect(executor.snapshot().balances.idr).toBe("99999000");
  });

  it("fills with fees and updates balances", async () => {
    const executor = new PaperExecutor();
    const service = new ExecutionService(executor);
    const result = await service.execute(paperRequest(), allow);
    expect(result.exchangeOrderId).toMatch(/^paper-/);
    const { fee } = executor.fill("o1", "1000");
    expect(Number(fee)).toBeGreaterThan(0);
    expect(executor.openOrders()).toHaveLength(0);
  });

  it("fills by exchange order id like cancel does", async () => {
    const executor = new PaperExecutor();
    const service = new ExecutionService(executor);
    const result = await service.execute(paperRequest(), allow);
    const { fee } = executor.fill(String(result.exchangeOrderId), "1000");
    expect(Number(fee)).toBeGreaterThan(0);
    expect(executor.openOrders()).toHaveLength(0);
  });

  it("cancels and refunds reserved quote", async () => {
    const executor = new PaperExecutor();
    const service = new ExecutionService(executor);
    await service.execute(paperRequest(), allow);
    expect(await executor.cancel("o1")).toBe(true);
    expect(executor.snapshot().balances.idr).toBe("100000000");
  });

  it("tops up and resets", () => {
    const executor = new PaperExecutor();
    expect(executor.topup("usdt", "500")).toBe("500");
    executor.reset();
    expect(executor.snapshot().balances.usdt).toBeUndefined();
  });

  it("restores a persisted snapshot for restart recovery", () => {
    const first = new PaperExecutor();
    first.topup("usdt", "500");
    const snapshot = first.snapshot();
    const second = new PaperExecutor();
    second.restore(snapshot);
    expect(second.snapshot().balances.usdt).toBe("500");
    expect(() => second.restore({ nope: true })).toThrow();
    expect(() => second.restore(null)).toThrow();
  });
});
