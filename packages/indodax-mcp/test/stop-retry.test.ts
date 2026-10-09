import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { AccountClient } from "@indodax-mcp/indodax-account";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

function stubTicker(last: string) {
  return {
    ticker: async () => ({ high: last, low: last, last, buy: last, sell: last }),
  } as unknown as PublicClient;
}

function textOf(result: { content: { text: string }[] }): string {
  const block = result.content.at(0);
  if (block === undefined) throw new Error("expected a text content block");
  return block.text;
}

describe("stop duplicate protection", () => {
  it("rejects an attach that doubles an armed stop with DUPLICATE_STOP", async () => {
    const built = buildIndodaxServer(loadEnv({ INDODAX_API_KEY: "k", INDODAX_API_SECRET: "s" }));
    built.app.accountClient = {
      openOrders: async () => [
        {
          orderId: "3216228",
          clientOrderId: "tp-1",
          symbol: "NOVAIDR",
          side: "SELL",
          price: "15000",
          origQty: "2",
          executedQty: "0",
          status: "OPEN",
        },
      ],
      getAccount: async () => ({ balances: [] }),
    } as unknown as AccountClient;
    // A manual stop already arms the same pair, side, and quantity.
    built.app.stops.add({
      pair: "nova_idr",
      side: "SELL",
      quantity: 2,
      stopPrice: 14000,
      limitPrice: 14000,
      mode: "live",
      acknowledgedAt: new Date().toISOString(),
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_oco_attach",
        arguments: { orderId: "3216228", stopPrice: 13000, acknowledged: true },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      const body = JSON.parse(textOf(result)) as {
        message: string;
        safeMetadata?: { reason?: string; stopId?: string };
      };
      expect(body.message).toContain("DUPLICATE_STOP");
      expect(body.safeMetadata?.reason).toBe("DUPLICATE_STOP");
      // Nothing new was armed: the manual stop is still the only one.
      expect(built.app.stops.list(true)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});

describe("stop retry", () => {
  it("re-arms a blocked stop and fires it with trigger prices recorded", async () => {
    clearCache();
    const built = buildIndodaxServer(loadEnv({}));
    built.app.publicClient = stubTicker("60000");
    const added = built.app.stops.add({
      pair: "btc_idr",
      side: "SELL",
      quantity: 0.5,
      stopPrice: 65000,
      limitPrice: 65000,
      mode: "paper",
    });
    built.app.stops.mark(added.id, "blocked", {
      reason: "stale block",
      blockedReason: "stale block",
      blockedFix: "retry",
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_stop_retry",
        arguments: { id: added.id },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (JSON.parse(textOf(result)) as { data: Record<string, unknown> }).data as {
        status: string;
        result: { status: string; triggerPrice: number; limitPrice: number } | null;
      };
      expect(data.status).toBe("triggered");
      expect(data.result?.triggerPrice).toBe(65000);
      expect(data.result?.limitPrice).toBe(65000);
      const record = built.app.stops.list(true).find((stop) => stop.id === added.id);
      expect(record?.status).toBe("triggered");
      expect(record?.triggeredPrice).toBe("60000");
      expect(built.app.paper.openOrders()).toHaveLength(1);
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("refuses a retry for a stop that is not blocked", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    const added = built.app.stops.add({
      pair: "btc_idr",
      side: "SELL",
      quantity: 0.5,
      stopPrice: 65000,
      limitPrice: 65000,
      mode: "paper",
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_stop_retry",
        arguments: { id: added.id },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("not blocked");
    } finally {
      await harness.close();
    }
  });
});

describe("attach side resolution", () => {
  function attachedApp(resting: Record<string, unknown>) {
    const built = buildIndodaxServer(loadEnv({ INDODAX_API_KEY: "k", INDODAX_API_SECRET: "s" }));
    built.app.accountClient = {
      openOrders: async () => [resting],
      getAccount: async () => ({ balances: [] }),
    } as unknown as AccountClient;
    return built;
  }

  const RESTING = {
    orderId: "99",
    clientOrderId: "tp-9",
    symbol: "HONEYIDR",
    price: "5000",
    origQty: "10",
    executedQty: "0",
    status: "OPEN",
  };

  it("reads a lowercase resting side instead of defaulting to SELL", async () => {
    const built = attachedApp({ ...RESTING, side: "buy" });
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_oco_attach",
        arguments: { orderId: "99", stopPrice: 4000, acknowledged: true },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (JSON.parse(textOf(result)) as { data: Record<string, unknown> }).data;
      expect(data.side).toBe("BUY");
    } finally {
      await harness.close();
    }
  });

  it("refuses to guess when the resting order reports no side", async () => {
    const built = attachedApp({ ...RESTING });
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_oco_attach",
        arguments: { orderId: "99", stopPrice: 4000, acknowledged: true },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("no usable side");
    } finally {
      await harness.close();
    }
  });
});
