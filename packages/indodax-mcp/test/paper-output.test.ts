import { describe, expect, it } from "vitest";
import { loadEnv } from "@d1zzy4-jethools/config";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

async function toolData(
  harness: Harness,
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: never }> {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { data: never };
}

describe("paper output detail", () => {
  it("paper status names open orders with ids", async () => {
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const placed = (await toolData(harness, "indodax_paper_order", {
        pair: "btc_idr",
        side: "BUY",
        price: 1000,
        quantity: 100,
      })) as { data: { exchangeOrderId: string } };
      expect(placed.data.exchangeOrderId).toMatch(/^paper-/);
      const body = (await toolData(harness, "indodax_paper_status", {})) as {
        data: { openOrders: number; openOrderIds: string[]; openOrdersTruncated: boolean };
      };
      expect(body.data.openOrders).toBe(1);
      expect(body.data.openOrderIds).toHaveLength(1);
      expect(body.data.openOrdersTruncated).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("paper fill and cancel return balances after the mutation", async () => {
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const placed = (await toolData(harness, "indodax_paper_order", {
        pair: "btc_idr",
        side: "BUY",
        price: 1000,
        quantity: 100,
      })) as { data: { exchangeOrderId: string } };
      const filledBody = (await toolData(harness, "indodax_paper_fill", {
        orderId: placed.data.exchangeOrderId,
        price: 1001,
      })) as {
        data: { status: string; fee: string; fillPrice: string; balances: Record<string, string> };
      };
      expect(filledBody.data.status).toBe("filled");
      expect(filledBody.data.fillPrice).toBe("1001");
      expect(filledBody.data.balances.btc).toBeDefined();
    } finally {
      await harness.close();
    }
    // Separate server: the 5s order cooldown would deny a second placement here.
    const second = buildIndodaxServer(loadEnv({}));
    const harness2 = await withInMemoryServer(second.server);
    try {
      const placed = (await toolData(harness2, "indodax_paper_order", {
        pair: "btc_idr",
        side: "BUY",
        price: 1000,
        quantity: 10,
      })) as { data: { exchangeOrderId: string } };
      const cancelledBody = (await toolData(harness2, "indodax_cancel_order", {
        orderId: placed.data.exchangeOrderId,
      })) as { data: { status: string; balances: Record<string, string> } };
      expect(cancelledBody.data.status).toBe("cancelled");
      expect(cancelledBody.data.balances.idr).toBeDefined();
    } finally {
      await harness2.close();
    }
  });
});
