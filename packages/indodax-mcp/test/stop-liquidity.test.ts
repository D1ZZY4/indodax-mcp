import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";
import { assessLiquidity, describeLock } from "@indodax-mcp/mcp-app/stop-liquidity";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

const TP_ORDER = {
  symbol: "HONEYIDR",
  orderId: 968628,
  fullOrderId: "honeyidr-limit-968628",
  clientOrderId: "honey-tp-001",
  side: "SELL",
  price: "53",
  origQty: "300",
  executedQty: "0",
  status: "NEW",
};

function liveApp(options?: {
  free?: string;
  locked?: string;
  orders?: unknown[];
  accountThrows?: boolean;
  ordersThrow?: boolean;
}) {
  clearCache();
  const built = buildIndodaxServer(
    loadEnv({
      APP_ENV: "live",
      TRADE_ENABLED: "true",
      INDODAX_API_KEY: "k",
      INDODAX_API_SECRET: "s",
    }),
  );
  built.app.scheduler.stopAll();
  built.app.publicClient = {
    ticker: async () => ({ high: "53", low: "47", last: "47", buy: "47", sell: "48" }),
    pairs: async () => [],
  } as unknown as PublicClient;
  const free = options?.free ?? "0";
  const locked = options?.locked ?? "300";
  built.app.accountClient = {
    getAccount: async () => {
      if (options?.accountThrows === true) throw new Error("account unreadable");
      return {
        canTrade: true,
        canWithdraw: false,
        balances: [
          { asset: "HONEY", free, locked },
          { asset: "IDR", free: "1000", locked: "0" },
        ],
      };
    },
    openOrders: async () => {
      if (options?.ordersThrow === true) throw new Error("orders unreadable");
      return options?.orders ?? [TP_ORDER];
    },
  } as unknown as NonNullable<AppServices["accountClient"]>;
  return built;
}

async function dataOf(harness: Harness, name: string, args: Record<string, unknown> = {}) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const body = JSON.parse(result.content[0]?.text ?? "{}") as {
    data?: unknown;
    warnings?: string[];
  };
  return {
    isError: result.isError === true,
    // Warnings travel inside the response envelope, not on the MCP result.
    warnings: body.warnings ?? [],
    body,
  };
}

/**
 * The exchange reserves balance per open order, so a resting take-profit holds
 * the quantity a cut-loss on the same asset needs. Arming the stop anyway
 * produced a stop that reported itself armed and then failed with -2010 on
 * every trigger, which is how a position ended up with no working protection.
 */
describe("stop liquidity detection", () => {
  it("reports the locking order when the quantity is reserved", async () => {
    const built = liveApp();
    const harness = await withInMemoryServer(built.server);
    try {
      const created = await dataOf(harness, "indodax_stop_create", {
        pair: "honey_idr",
        side: "SELL",
        quantity: 300,
        stopPrice: 46,
        mode: "live",
        acknowledged: true,
      });
      expect(created.isError).toBe(false);
      const data = created.body.data as unknown as {
        liquidity: { blocked: boolean; asset: string; required: string; free: string };
        warning: string;
        remedy: string;
      };
      expect(data.liquidity.blocked).toBe(true);
      expect(data.liquidity.asset).toBe("honey");
      expect(data.liquidity.required).toBe("300");
      expect(data.liquidity.free).toBe("0");
      // The operator is told the stop is unsafe and why, not just that it armed.
      expect(data.warning).toContain("-2010");
      expect(data.warning).toContain("honey-tp-001");
      expect(created.warnings.join(" ")).toContain("not free");
    } finally {
      await harness.close();
    }
  });

  it("does not report a block when the quantity is free", async () => {
    const built = liveApp({ free: "300", locked: "0", orders: [] });
    const harness = await withInMemoryServer(built.server);
    try {
      const created = await dataOf(harness, "indodax_stop_create", {
        pair: "honey_idr",
        side: "SELL",
        quantity: 300,
        stopPrice: 46,
        mode: "live",
        acknowledged: true,
      });
      expect(created.isError).toBe(false);
      expect(created.warnings).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("does not treat a long entry reservation as blocking its own sell stop", async () => {
    // A BUY order locks quote, not the base asset, so a sell stop on a long
    // position is not blocked by the buy that opened it. Reporting a block here
    // would mark every healthy long as unsafe.
    const built = liveApp({
      free: "0",
      locked: "300",
      orders: [{ ...TP_ORDER, side: "BUY", clientOrderId: "honey-entry-001" }],
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const created = await dataOf(harness, "indodax_stop_create", {
        pair: "honey_idr",
        side: "SELL",
        quantity: 300,
        stopPrice: 46,
        mode: "live",
        acknowledged: true,
      });
      // Blocked on free balance, but nothing on the sell side is named: the
      // entry order must not be blamed for a base-asset reservation it never made.
      const text = created.warnings.join(" ");
      expect(text).not.toContain("honey-entry-001");
    } finally {
      await harness.close();
    }
  });

  it("stays silent when the account cannot be read", async () => {
    // Unknown is not blocked: a false block would make a working stop look broken.
    const built = liveApp({ accountThrows: true });
    const assessment = await assessLiquidity(built.app, {
      pair: "honey_idr",
      side: "SELL",
      quantity: new Decimal(300),
    });
    expect(assessment.blocked).toBe(false);
    expect(assessment.locked).toBeNull();
    expect(describeLock(assessment)).toBeNull();
  });

  it("ignores a fully executed order when naming the blocker", async () => {
    // The account still reports 0 free, so the stop is genuinely blocked; what
    // matters is that the executed order is not named as the holder, because
    // its reservation is already gone.
    const built = liveApp({
      orders: [{ ...TP_ORDER, executedQty: "300", status: "FILLED" }],
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const created = await dataOf(harness, "indodax_stop_create", {
        pair: "honey_idr",
        side: "SELL",
        quantity: 300,
        stopPrice: 46,
        mode: "live",
        acknowledged: true,
      });
      expect(created.isError).toBe(false);
      // Blocked on free balance, but nothing is named as the holder.
      const text = created.warnings.join(" ");
      expect(text).not.toContain("honey-tp-001");
      expect(text).toContain("an open order");
    } finally {
      await harness.close();
    }
  });
});

describe("oco_attach links a stop to a resting take-profit", () => {
  it("records the link without placing or cancelling anything", async () => {
    const built = liveApp();
    const harness = await withInMemoryServer(built.server);
    try {
      const attached = await dataOf(harness, "indodax_oco_attach", {
        orderId: "968628",
        stopPrice: 46,
        acknowledged: true,
      });
      expect(attached.isError).toBe(false);
      const data = attached.body.data as unknown as {
        id: string;
        linkedOrderId: string;
        linkedClientOrderId: string;
        summary: string;
      };
      expect(data.linkedOrderId).toBe("968628");
      expect(data.linkedClientOrderId).toBe("honey-tp-001");
      // The stop is recorded; no order reached the exchange.
      expect(built.app.paper.openOrders()).toHaveLength(0);
      expect(built.app.stops.list().some((s) => s.linkedOrderId === "968628")).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("requires acknowledgement for a live cut-loss", async () => {
    const built = liveApp();
    const harness = await withInMemoryServer(built.server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_oco_attach",
        arguments: { orderId: "968628", stopPrice: 46 },
      });
      expect(denied.isError).toBe(true);
      const body = JSON.parse(
        (denied.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { message: string };
      expect(body.message).toContain("acknowledged");
    } finally {
      await harness.close();
    }
  });

  it("names the open orders when the id does not match", async () => {
    const built = liveApp();
    const harness = await withInMemoryServer(built.server);
    try {
      const failed = await harness.client.callTool({
        name: "indodax_oco_attach",
        arguments: { orderId: "does-not-exist", stopPrice: 46, acknowledged: true },
      });
      expect(failed.isError).toBe(true);
      const body = JSON.parse(
        (failed.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { message: string };
      // The remedy names what is actually resting, so the caller can retry.
      expect(body.message).toContain("honey-tp-001");
    } finally {
      await harness.close();
    }
  });

  it("refuses to attach the same order twice", async () => {
    const built = liveApp();
    const harness = await withInMemoryServer(built.server);
    try {
      await harness.client.callTool({
        name: "indodax_oco_attach",
        arguments: { orderId: "968628", stopPrice: 46, acknowledged: true },
      });
      const second = await harness.client.callTool({
        name: "indodax_oco_attach",
        arguments: { orderId: "968628", stopPrice: 45, acknowledged: true },
      });
      expect(second.isError).toBe(true);
      const body = JSON.parse(
        (second.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { message: string };
      expect(body.message).toContain("already attached");
    } finally {
      await harness.close();
    }
  });

  it("warns when the market already sits at the trigger", async () => {
    // The resting take-profit stays so the order can be linked; only the free
    // balance changes so the liquidity check stays quiet.
    const built = liveApp({ free: "300", locked: "0" });
    const harness = await withInMemoryServer(built.server);
    try {
      const attached = await dataOf(harness, "indodax_oco_attach", {
        orderId: "968628",
        stopPrice: 48,
        acknowledged: true,
      });
      // Market last is 47, so a SELL stop at 48 fires immediately.
      const data = attached.body.data as unknown as { marketNote: string };
      expect(data.marketNote).toContain("already at 47");
    } finally {
      await harness.close();
    }
  });
});
