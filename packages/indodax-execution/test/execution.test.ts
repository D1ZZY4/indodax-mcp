import { describe, expect, it } from "vitest";
import {
  ExecutionService,
  type ExecutionBackend,
  type ExecutionRequest,
} from "@indodax-mcp/indodax-execution";
import { LiveExecutor } from "@indodax-mcp/indodax-execution/live";
import { TapiV2Signer } from "@indodax-mcp/indodax-auth";
import type { RiskDecision } from "@indodax-mcp/core";

const allow: RiskDecision = { outcome: "ALLOW", reasons: [], message: "allowed" };
const deny: RiskDecision = { outcome: "DENY", reasons: ["KILL_SWITCH"], message: "stopped" };

const backend: ExecutionBackend = {
  name: "ok",
  submit: async (request: ExecutionRequest) => ({
    internalOrderId: request.order.internalOrderId,
    exchangeOrderId: null,
    accepted: true,
    message: "accepted",
    executedAt: new Date().toISOString(),
  }),
  cancel: async () => true,
};

describe("execution service", () => {
  it("rejects without risk approval", async () => {
    const service = new ExecutionService(backend);
    const request = {
      order: { internalOrderId: "o1", state: "ACCEPTED" },
      mode: "paper",
      capability: "PAPER",
      correlationId: "c1",
      requestedAt: new Date().toISOString(),
    } as ExecutionRequest;
    await expect(service.execute(request, deny)).rejects.toThrow();
  });

  it("delegates approved requests to the backend", async () => {
    const service = new ExecutionService(backend);
    const request = {
      order: { internalOrderId: "o1", state: "ACCEPTED" },
      mode: "paper",
      capability: "PAPER",
      correlationId: "c1",
      requestedAt: new Date().toISOString(),
    } as ExecutionRequest;
    const result = await service.execute(request, allow);
    expect(result.accepted).toBe(true);
    expect(service.backendName).toBe("ok");
  });

  it("rejects orders that skipped risk review", async () => {
    const service = new ExecutionService(backend);
    const request = {
      order: { internalOrderId: "o1", state: "NEW" },
      mode: "paper",
      capability: "PAPER",
      correlationId: "c1",
      requestedAt: new Date().toISOString(),
    } as ExecutionRequest;
    await expect(service.execute(request, allow)).rejects.toThrow(/ACCEPTED by risk review/);
  });

  it("rejects live cancels with nonzero exchange codes", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ code: -2010, msg: "rejected" }),
      )) as import("@indodax-mcp/transport").FetchFn;
    const executor = new LiveExecutor({ signer: new TapiV2Signer("k", "s"), fetchFn });
    await expect(executor.cancelByExchangeId("BTCIDR", "1")).rejects.toThrow(/rejected cancel/);
  });

  it("accepts live cancels with zero exchange codes", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ code: 0, data: {} }),
      )) as import("@indodax-mcp/transport").FetchFn;
    const executor = new LiveExecutor({ signer: new TapiV2Signer("k", "s"), fetchFn });
    await expect(executor.cancelByExchangeId("BTCIDR", "1")).resolves.toBe(true);
  });

  it("submits live limit orders through the signed adapter", async () => {
    let seenUrl = "";
    let seenBody = "";
    const fetchFn = (async (input: string, init?: RequestInit) => {
      seenUrl = String(input);
      seenBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ code: 0, data: { orderId: "ex-9" } }));
    }) as import("@indodax-mcp/transport").FetchFn;
    const executor = new LiveExecutor({ signer: new TapiV2Signer("k", "s"), fetchFn });
    const result = await executor.submit({
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
        state: "NEW",
        environment: "live",
        tenantId: "t",
        exchangeAccountId: "a",
        strategyId: null,
        runId: null,
        riskDecisionId: null,
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      mode: "live",
      capability: "TRADE",
      correlationId: "corr-1",
      requestedAt: new Date().toISOString(),
    });
    expect(result.accepted).toBe(true);
    expect(result.exchangeOrderId).toBe("ex-9");
    expect(seenUrl).toContain("/api/v2/order");
    expect(seenBody).toContain("symbol=BTCIDR");
  });

  it("maps rate limits and timeouts without retrying the submission", async () => {
    let calls = 0;
    const limited = (async () => {
      calls += 1;
      return new Response("slow", { status: 429 });
    }) as import("@indodax-mcp/transport").FetchFn;
    const executor = new LiveExecutor({ signer: new TapiV2Signer("k", "s"), fetchFn: limited });
    const request = {
      order: {
        internalOrderId: "o1",
        clientOrderId: "c1",
        exchangeOrderId: null,
        symbol: { base: "btc", quote: "idr" },
        side: "BUY" as const,
        orderType: "LIMIT" as const,
        price: "1000",
        quantity: "1",
        remaining: "1",
        state: "NEW" as const,
        environment: "live" as const,
        tenantId: "t",
        exchangeAccountId: "a",
        strategyId: null,
        runId: null,
        riskDecisionId: null,
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      mode: "live" as const,
      capability: "TRADE" as const,
      correlationId: "corr-1",
      requestedAt: new Date().toISOString(),
    };
    await expect(executor.submit(request)).rejects.toThrow(/rate limited/i);
    expect(calls).toBe(1);

    const aborting = (async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as import("@indodax-mcp/transport").FetchFn;
    const timeoutExecutor = new LiveExecutor({
      signer: new TapiV2Signer("k", "s"),
      fetchFn: aborting,
    });
    await expect(timeoutExecutor.submit(request)).rejects.toThrow();
  });

  it("passes timeInForce and STP mode only when set", async () => {
    let seenBody = "";
    const fetchFn = (async (_input: string, init?: RequestInit) => {
      seenBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ code: 0, data: { orderId: "ex-1" } }));
    }) as import("@indodax-mcp/transport").FetchFn;
    const executor = new LiveExecutor({ signer: new TapiV2Signer("k", "s"), fetchFn });
    const base = {
      internalOrderId: "o1",
      clientOrderId: "c1",
      exchangeOrderId: null,
      symbol: { base: "btc", quote: "idr" },
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      price: "1000",
      quantity: "1",
      remaining: "1",
      state: "NEW" as const,
      environment: "live" as const,
      tenantId: "t",
      exchangeAccountId: "a",
      strategyId: null,
      runId: null,
      riskDecisionId: null,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await executor.submit({
      order: { ...base, timeInForce: "MOC", stpMode: "EXPIRE_BOTH" },
      mode: "live",
      capability: "TRADE",
      correlationId: "corr-1",
      requestedAt: new Date().toISOString(),
    });
    expect(seenBody).toContain("timeInForce=MOC");
    expect(seenBody).toContain("selfTradePreventionMode=EXPIRE_BOTH");
    await executor.submit({
      order: base,
      mode: "live",
      capability: "TRADE",
      correlationId: "corr-2",
      requestedAt: new Date().toISOString(),
    });
    expect(seenBody).not.toContain("timeInForce");
    expect(seenBody).not.toContain("selfTradePreventionMode");
  });

  it("translates terse insufficient-balance rejections into next actions", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ code: -2010, msg: "Account has insufficient balance" }),
      )) as import("@indodax-mcp/transport").FetchFn;
    const executor = new LiveExecutor({ signer: new TapiV2Signer("k", "s"), fetchFn });
    const request = {
      order: {
        internalOrderId: "o1",
        clientOrderId: "c1",
        exchangeOrderId: null,
        symbol: { base: "btc", quote: "idr" },
        side: "BUY" as const,
        orderType: "LIMIT" as const,
        price: "1000",
        quantity: "1",
        remaining: "1",
        state: "NEW" as const,
        environment: "live" as const,
        tenantId: "t",
        exchangeAccountId: "a",
        strategyId: null,
        runId: null,
        riskDecisionId: null,
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      mode: "live" as const,
      capability: "TRADE" as const,
      correlationId: "corr-1",
      requestedAt: new Date().toISOString(),
    };
    await expect(executor.submit(request)).rejects.toThrow(/indodax_balances/);
  });

  it("cancels by client order id when exchange id is unknown", async () => {
    let seenUrl = "";
    const fetchFn = (async (input: string) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ code: 0, data: {} }));
    }) as import("@indodax-mcp/transport").FetchFn;
    const executor = new LiveExecutor({ signer: new TapiV2Signer("k", "s"), fetchFn });
    await expect(executor.cancelByExchangeId("BTCIDR", undefined, "my-cid-1")).resolves.toBe(true);
    expect(seenUrl).toContain("origClientOrderId=my-cid-1");
    await expect(executor.cancelByExchangeId("BTCIDR")).rejects.toThrow(/orderId or clientOrderId/);
  });

  it("uppercases lowercase cancel symbols like submit does", async () => {
    let seenUrl = "";
    const fetchFn = (async (input: string) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ code: 0, data: {} }));
    }) as import("@indodax-mcp/transport").FetchFn;
    const executor = new LiveExecutor({ signer: new TapiV2Signer("k", "s"), fetchFn });
    await expect(executor.cancelByExchangeId("btc_idr", "42")).resolves.toBe(true);
    expect(seenUrl).toContain("symbol=BTCIDR");
    await expect(executor.cancelByExchangeId("!!!", "42")).rejects.toThrow(/invalid symbol/);
  });
});
