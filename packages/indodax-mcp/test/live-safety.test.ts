import { describe, expect, it } from "vitest";
import { loadEnv } from "@d1zzy4-jethools/config";
import {
  ExchangeNetworkError,
  ExchangeTimeoutError,
  OrderRejectedError,
  isAppError,
} from "@d1zzy4-jethools/errors";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";
import { ambiguousToUnknown, placeLiveOrder } from "@d1zzy4-jethools/mcp-app/tools/order-intent";

function liveApp() {
  const { app, server } = buildIndodaxServer(
    loadEnv({
      APP_ENV: "live",
      TRADE_ENABLED: "true",
      INDODAX_API_KEY: "k",
      INDODAX_API_SECRET: "s",
    }),
  );
  const live = app.liveExecutor;
  if (!live) throw new Error("live executor requires credentials");
  return { app, server, live };
}

describe("live unknown outcomes", () => {
  it("maps a submit timeout to unknown instead of retryable", async () => {
    const { app, live } = liveApp();
    live.submit = async () => {
      throw ExchangeTimeoutError("timed out after accept");
    };
    const error = await placeLiveOrder(app, {
      pair: "btc_idr",
      side: "BUY",
      quantity: 100,
      price: 1000,
      acknowledged: true,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isAppError(error)).toBe(true);
    if (!isAppError(error)) throw new Error("expected an AppError");
    expect(error.code).toBe("UnknownExecutionResultError");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("reconcile before retry");
    expect(error.correlationId).toBeDefined();
  });

  it("lets explicit exchange rejections pass through unchanged", async () => {
    const { app, live } = liveApp();
    live.submit = async () => {
      throw OrderRejectedError("exchange said no");
    };
    const error = await placeLiveOrder(app, {
      pair: "btc_idr",
      side: "BUY",
      quantity: 100,
      price: 1000,
      acknowledged: true,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isAppError(error)).toBe(true);
    if (!isAppError(error)) throw new Error("expected an AppError");
    expect(error.code).toBe("OrderRejectedError");
  });

  it("reports an ambiguous live cancel as unknown over MCP", async () => {
    const { server, live } = liveApp();
    live.cancelByExchangeId = async () => {
      throw ExchangeNetworkError("connection reset");
    };
    const harness = await withInMemoryServer(server);
    try {
      const result = await harness.client.callTool({
        name: "indodax_cancel_order",
        arguments: { orderId: "42", mode: "live", acknowledged: true, symbol: "BTCIDR" },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])
        .map((block) => block.text)
        .join("\n");
      const body = JSON.parse(text) as { code?: string; retryable?: boolean };
      expect(body.code).toBe("UnknownExecutionResultError");
      expect(body.retryable).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("leaves non-transport errors untouched", () => {
    const original = new TypeError("boom");
    expect(ambiguousToUnknown(original, "c1", "order-1")).toBe(original);
    const rejected = OrderRejectedError("no");
    expect(ambiguousToUnknown(rejected, "c1", "order-1")).toBe(rejected);
  });
});
