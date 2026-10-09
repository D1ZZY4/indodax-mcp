import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

/**
 * A summary row that carries only an exchange order id gives a caller nothing
 * to render a position from, so it infers a direction. That produced a phantom
 * SELL for an order that was actually a BUY, which reads as an unrequested live
 * sell and is alarming in exactly the situation where calm matters.
 */
function appWithOpenOrders(orders: unknown[]) {
  const built = buildIndodaxServer(
    loadEnv({
      APP_ENV: "live",
      TRADE_ENABLED: "true",
      INDODAX_API_KEY: "k",
      INDODAX_API_SECRET: "s",
    }),
  );
  built.app.scheduler.stopAll();
  built.app.accountClient = {
    getAccount: async () => ({
      canTrade: true,
      canWithdraw: false,
      balances: [
        { asset: "HONEY", free: "0", locked: "300" },
        { asset: "IDR", free: "500", locked: "0" },
      ],
    }),
    openOrders: async () => orders,
    myTrades: async () => ({ data: [] }),
  } as unknown as NonNullable<AppServices["accountClient"]>;
  return built;
}

const HONEY_BUY: Record<string, unknown> = {
  symbol: "HONEYIDR",
  orderId: 968628,
  fullOrderId: "honeyidr-limit-968628",
  clientOrderId: "honey-buy-001",
  side: "BUY",
  price: "49",
  origQty: "300",
  executedQty: "0",
  status: "NEW",
};

describe("reconcile_full open order rows", () => {
  it("reports the exchange side verbatim", async () => {
    const built = appWithOpenOrders([HONEY_BUY]);
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_reconcile_exchange",
        arguments: { scope: "full", symbol: "honeyidr" },
      })) as { content: { type: string; text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (
        JSON.parse(result.content[0]?.text ?? "{}") as {
          data: {
            exchange: {
              openOrders: {
                side: string | null;
                price: string | null;
                quantity: string | null;
                symbol: string | null;
                clientOrderId: string | null;
                state: string;
              }[];
            };
          };
        }
      ).data;
      const row = data.exchange.openOrders.at(0);
      expect(row?.side).toBe("BUY");
      expect(row?.price).toBe("49");
      expect(row?.quantity).toBe("300");
      expect(row?.symbol).toBe("HONEYIDR");
      expect(row?.clientOrderId).toBe("honey-buy-001");
      expect(row?.state).toBe("NEW");
    } finally {
      await harness.close();
    }
  });

  it("never invents a side when the exchange omits it", async () => {
    const built = appWithOpenOrders([{ symbol: "HONEYIDR", orderId: 1, origQty: "300" }]);
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_reconcile_exchange",
        arguments: { scope: "full", symbol: "honeyidr" },
      })) as { content: { type: string; text: string }[] };
      const data = (
        JSON.parse(result.content[0]?.text ?? "{}") as {
          data: { exchange: { openOrders: { side: string | null; state: string }[] } };
        }
      ).data;
      // Null, not a guess: a wrong direction is worse than an absent one.
      expect(data.exchange.openOrders.at(0)?.side).toBeNull();
      expect(data.exchange.openOrders.at(0)?.state).toBe("OPEN");
    } finally {
      await harness.close();
    }
  });

  it("distinguishes a SELL take-profit from a BUY entry", async () => {
    const built = appWithOpenOrders([
      HONEY_BUY,
      { ...HONEY_BUY, orderId: 968629, side: "SELL", price: "53", clientOrderId: "honey-tp-001" },
    ]);
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_reconcile_exchange",
        arguments: { scope: "full", symbol: "honeyidr" },
      })) as { content: { type: string; text: string }[] };
      const data = (
        JSON.parse(result.content[0]?.text ?? "{}") as {
          data: {
            exchange: { openOrders: { side: string; price: string; clientOrderId: string }[] };
          };
        }
      ).data;
      // Each row keeps its own direction, so a caller cannot collapse them.
      expect(data.exchange.openOrders.map((o) => o.side)).toEqual(["BUY", "SELL"]);
      expect(data.exchange.openOrders.map((o) => o.price)).toEqual(["49", "53"]);
    } finally {
      await harness.close();
    }
  });
});
