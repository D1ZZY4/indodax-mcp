import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

async function dataOf(harness: Harness, name: string, args: Record<string, unknown> = {}) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { data: never };
}

function withTicker(last: string) {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  built.app.publicClient = {
    ticker: async () => ({ high: last, low: last, last, buy: last, sell: last }),
    pairs: async () => [],
  } as unknown as PublicClient;
  clearCache();
  return built;
}

describe("paper orders report the requested order type", () => {
  it("records a MARKET request as MARKET and fills it at the live price", async () => {
    const built = withTicker("1000");
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await dataOf(harness, "indodax_paper_order", {
        pair: "btc_idr",
        side: "BUY",
        orderType: "MARKET",
        quantity: 50,
      });
      const data = body.data as { orderType: string; status: string; fillPrice: string };
      expect(data.orderType).toBe("MARKET");
      expect(data.status).toBe("filled");
      expect(data.fillPrice).toBe("1000");
      expect(built.app.paper.snapshot().orders[0]?.orderType).toBe("MARKET");
    } finally {
      await harness.close();
    }
  });

  it("keeps LIMIT reported as LIMIT", async () => {
    const built = withTicker("1000");
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await dataOf(harness, "indodax_paper_order", {
        pair: "btc_idr",
        side: "BUY",
        price: 1000,
        quantity: 50,
      });
      expect((body.data as { orderType: string }).orderType).toBe("LIMIT");
      expect(built.app.paper.snapshot().orders[0]?.orderType).toBe("LIMIT");
    } finally {
      await harness.close();
    }
  });

  it("replays a repeated client order id with the same order type", async () => {
    const built = withTicker("1000");
    const harness = await withInMemoryServer(built.server);
    try {
      const args = {
        pair: "btc_idr",
        side: "BUY",
        orderType: "MARKET",
        quantity: 50,
        clientOrderId: "mkt-replay",
      };
      await dataOf(harness, "indodax_paper_order", args);
      const replay = await dataOf(harness, "indodax_paper_order", args);
      expect((replay.data as { orderType: string }).orderType).toBe("MARKET");
      expect(built.app.paper.snapshot().tradeCount).toBe(1);
    } finally {
      await harness.close();
    }
  });
});
