import { describe, expect, it } from "vitest";
import { loadEnv } from "@d1zzy4-jethools/config";
import type { PublicClient } from "@d1zzy4-jethools/indodax-client";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";

const BOOK = {
  buy: [
    ["100", "1"],
    ["99", "2"],
  ],
  sell: [
    ["101", "1"],
    ["102", "2"],
  ],
};

function stubbed() {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.publicClient = {
    depth: async () => BOOK,
  } as unknown as PublicClient;
  return built;
}

async function dataOf(call: Promise<unknown>) {
  const result = (await call) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  const text = result.content[0]?.text ?? "{}";
  return (JSON.parse(text) as { data: Record<string, string | null> }).data;
}

describe("quote", () => {
  it("estimates an instant fill across levels", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const data = await dataOf(
        harness.client.callTool({
          name: "indodax_quote",
          arguments: { pair: "BTCIDR", side: "BUY", quantity: 1.5, price: 102 },
        }),
      );
      expect(data.pair).toBe("btc_idr");
      expect(data.verdict).toBe("instant");
      // (101*1 + 102*0.5) / 1.5 = 101.333...
      expect(data.estimatedAvgPrice?.startsWith("101.333")).toBe(true);
      expect(data.fillableQuantity).toBe("1.5");
    } finally {
      await harness.close();
    }
  });

  it("parks a limit outside the book", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const data = await dataOf(
        harness.client.callTool({
          name: "indodax_quote",
          arguments: { pair: "btc_idr", side: "BUY", quantity: 1, price: 100 },
        }),
      );
      expect(data.verdict).toBe("parked");
      expect(data.estimatedAvgPrice).toBeNull();
      expect(data.bestAsk).toBe("101");
    } finally {
      await harness.close();
    }
  });

  it("reports partial fills when depth is short", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const data = await dataOf(
        harness.client.callTool({
          name: "indodax_quote",
          arguments: { pair: "btc_idr", side: "SELL", quantity: 5 },
        }),
      );
      expect(data.verdict).toBe("partial");
      expect(data.fillableQuantity).toBe("3");
    } finally {
      await harness.close();
    }
  });

  it("rejects invalid pairs without touching the book", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const result = await harness.client.callTool({
        name: "indodax_quote",
        arguments: { pair: "!!!", side: "BUY", quantity: 1 },
      });
      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
