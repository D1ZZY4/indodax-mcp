import { describe, expect, it } from "vitest";
import { LiveExecutor } from "@indodax-mcp/indodax-execution/live";
import { TapiV2Signer } from "@indodax-mcp/indodax-auth";
import type { FetchFn } from "@indodax-mcp/transport";
import type { OrderRecord } from "@indodax-mcp/indodax-orders";
import type { ExecutionRequest } from "@indodax-mcp/indodax-execution";

/**
 * Exchange rejections arrive as HTTP 4xx with a JSON body, not as HTTP 200
 * with a nonzero code. The retry helper threw on the status before the
 * executor could read the payload, so every rejection reached the caller as a
 * raw transport string with no code and no next action. These tests pin the
 * translated form for both delivery paths.
 */

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  const now = new Date().toISOString();
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
    state: "ACCEPTED",
    environment: "live",
    tenantId: "t",
    exchangeAccountId: "a",
    strategyId: null,
    runId: null,
    riskDecisionId: null,
    submittedAt: now,
    updatedAt: now,
    ...overrides,
  } as OrderRecord;
}

function request(overrides: Partial<OrderRecord> = {}): ExecutionRequest {
  return {
    order: order(overrides),
    mode: "live",
    capability: "TRADE",
    correlationId: "corr-1",
    requestedAt: new Date().toISOString(),
  } as ExecutionRequest;
}

function httpError(status: number, body: unknown): FetchFn {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as FetchFn;
}

function executor(fetchFn: FetchFn): LiveExecutor {
  return new LiveExecutor({ signer: new TapiV2Signer("k", "s"), fetchFn });
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error === null) throw new Error("expected a rejection");
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  expect(code).toBe("OrderRejectedError");
  return message;
}

describe("live rejection translation", () => {
  it("translates a 4xx insufficient balance into a next action", async () => {
    const message = await rejectionMessage(
      executor(httpError(400, { code: -2010, msg: "Insufficient balance" })).submit(request()),
    );
    expect(message).toContain("next:");
    expect(message).toContain("indodax_balances");
    expect(message).toContain("-2010");
    expect(message).not.toContain("unexpected HTTP");
  });

  it("translates an unauthorized IP rejection without blaming signing", async () => {
    const message = await rejectionMessage(
      executor(httpError(403, { code: -2015, msg: "Unauthorized IP address." })).submit(request()),
    );
    expect(message).toContain("-2015");
    expect(message).toContain("IP");
    expect(message).toContain("next:");
  });

  it("still translates a 200 response carrying a nonzero code", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ code: -2010, msg: "Insufficient balance" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as FetchFn;
    const message = await rejectionMessage(executor(fetchFn).submit(request()));
    expect(message).toContain("indodax_balances");
  });

  it("translates a 4xx cancel rejection", async () => {
    const message = await rejectionMessage(
      executor(httpError(400, { code: -2013, msg: "Order does not exist" })).cancelByExchangeId(
        "btc_idr",
        "42",
      ),
    );
    expect(message).toContain("cancel");
    expect(message).toContain("-2013");
    expect(message).not.toContain("unexpected HTTP");
  });

  it("falls back to text when the exchange sends no known code", async () => {
    const message = await rejectionMessage(
      executor(httpError(400, { msg: "invalid parameter" })).submit(request()),
    );
    expect(message).toContain("invalid parameter");
    expect(message).toContain("next:");
  });

  it("keeps a non rejection HTTP failure as a transport error", async () => {
    // A 503 must stay retryable and must not be dressed up as a rejection.
    const fetchFn = (async () => new Response("upstream down", { status: 503 })) as FetchFn;
    const error = await executor(fetchFn)
      .submit(request())
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect((error as { code?: string }).code).toBe("ExchangeNetworkError");
  });

  it("reports the raw payload for traceability", async () => {
    const message = await rejectionMessage(
      executor(httpError(400, { code: -2010, msg: "Insufficient balance" })).submit(request()),
    );
    expect(message).toContain("Insufficient balance");
  });
});
