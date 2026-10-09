import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

/**
 * Three tools report the top of book under three different names, and one of
 * them reported none at all. A harness that read `bestBid` from the orderbook
 * got undefined and rendered it as a price of zero, which reads as a real
 * quote. These tests pin the field names and the empty-side contract.
 */

const BOOK = {
  buy: [
    ["6100", "163.36"],
    ["6101", "42.84"],
    ["6105", "68.81"],
  ],
  sell: [
    ["6249", "2.65"],
    ["6250", "54.44"],
    ["6277", "107.6"],
  ],
};

type Envelope = { data: Record<string, unknown> };

async function dataOf(
  harness: Awaited<ReturnType<typeof withInMemoryServer>>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Envelope> {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as Envelope;
}

function withBook(book: unknown) {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  built.app.publicClient = { depth: async () => book } as unknown as PublicClient;
  return built;
}

describe("orderbook top of book", () => {
  it("reports bestBid, bestAsk, and sizes under the quote field names", async () => {
    const { server } = withBook(BOOK);
    const harness = await withInMemoryServer(server);
    try {
      const data = (await dataOf(harness, "indodax_orderbook", { pair: "cng_idr", levels: 5 }))
        .data;
      expect(data.bestBid).toBe("6105");
      expect(data.bestAsk).toBe("6249");
      expect(data.bestBidQty).toBe("68.81");
      expect(data.bestAskQty).toBe("2.65");
      expect(data.empty).toBe(false);
      // Canonical aliases: `bids` is `buy` and `asks` is `sell`, so a harness
      // reading either spelling sees the same levels.
      expect(data.bids).toEqual(data.buy);
      expect(data.asks).toEqual(data.sell);
      // (6249 - 6105) / 6177 mid = 2.33%
      expect(data.spread).toBe("144");
      expect(data.spreadPct).toBe("2.33");
    } finally {
      await harness.close();
    }
  });

  it("picks the top level rather than the first array row", async () => {
    // The exchange does not guarantee ordering, so the best price is derived.
    const { server } = withBook({
      buy: [
        ["10", "1"],
        ["12", "5"],
      ],
      sell: [
        ["20", "2"],
        ["18", "9"],
      ],
    });
    const harness = await withInMemoryServer(server);
    try {
      const data = (await dataOf(harness, "indodax_orderbook", { pair: "btc_idr" })).data;
      expect(data.bestBid).toBe("12");
      expect(data.bestAsk).toBe("18");
    } finally {
      await harness.close();
    }
  });

  it("reports null on an empty side instead of a price of zero", async () => {
    const { server } = withBook({ buy: [], sell: [["100", "5"]] });
    const harness = await withInMemoryServer(server);
    try {
      const data = (await dataOf(harness, "indodax_orderbook", { pair: "btc_idr" })).data;
      expect(data.bestBid).toBeNull();
      expect(data.bestAsk).toBe("100");
      expect(data.spread).toBeNull();
      expect(data.spreadPct).toBeNull();
      expect(data.empty).toBe(true);
      expect(String(data.note)).toContain("null for that side rather than zero");
    } finally {
      await harness.close();
    }
  });

  it("skips unreadable levels instead of failing the whole book", async () => {
    const { server } = withBook({
      buy: [
        ["bad", "1"],
        ["50", "3"],
      ] as [string, string][],
      sell: [["60", "2"]],
    });
    const harness = await withInMemoryServer(server);
    try {
      const data = (await dataOf(harness, "indodax_orderbook", { pair: "btc_idr" })).data;
      expect(data.bestBid).toBe("50");
      expect(data.bestAsk).toBe("60");
    } finally {
      await harness.close();
    }
  });

  it("agrees with indodax_quote on the same book", async () => {
    const built = withBook(BOOK);
    const harness = await withInMemoryServer(built.server);
    try {
      const book = (await dataOf(harness, "indodax_orderbook", { pair: "cng_idr" })).data;
      const quote = (
        await dataOf(harness, "indodax_quote", {
          pair: "cng_idr",
          side: "BUY",
          quantity: 1,
        })
      ).data;
      expect(book.bestBid).toBe(quote.bestBid);
      expect(book.bestAsk).toBe(quote.bestAsk);
    } finally {
      await harness.close();
    }
  });
});
