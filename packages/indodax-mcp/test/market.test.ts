import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "../src/index.js";

const tickers = {
  tickers: {
    btc_idr: { high: "2", low: "1", last: "2", buy: "2", sell: "2" },
    eth_usdt: { high: "2", low: "1", last: "2", buy: "2", sell: "2" },
    btc_usdt: { high: "2", low: "1", last: "2", buy: "2", sell: "2" },
  },
};

function stubbed() {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.publicClient = {
    tickerAll: async () => tickers,
    trades: async () => [1, 2, 3, 4, 5],
  } as unknown as PublicClient;
  return built;
}

async function dataOf(call: Promise<{ content: unknown; isError?: boolean }>) {
  const result = await call;
  expect(result.isError).not.toBe(true);
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
  return (JSON.parse(text) as { data: Record<string, unknown> }).data;
}

describe("market filters", () => {
  it("filters tickers by quote and limits rows", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const filtered = await dataOf(
        harness.client.callTool({ name: "indodax_tickers_all", arguments: { quote: "usdt" } }),
      );
      expect(Object.keys(filtered)).toEqual(["eth_usdt", "btc_usdt"]);
      const limited = await dataOf(
        harness.client.callTool({ name: "indodax_tickers_all", arguments: { limit: 1 } }),
      );
      expect(Object.keys(limited)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("limits public trades", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const limited = await dataOf(
        harness.client.callTool({
          name: "indodax_trades",
          arguments: { pair: "btc_idr", limit: 2 },
        }),
      );
      expect(limited).toHaveLength(2);
    } finally {
      await harness.close();
    }
  });
});
