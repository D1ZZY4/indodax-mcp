import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

/**
 * A polling loop was recomputing position value and PnL by hand every round.
 * The two failure modes this pins: a leg with no direct pair must never be
 * valued at zero, and weights must be withheld when any leg is unpriced.
 */
const PAIRS = [
  {
    id: "radidr",
    symbol: "RADIDR",
    ticker_id: "rad_idr",
    base_currency: "idr",
    traded_currency: "rad",
  },
];

function stubbed(prices: Record<string, string>) {
  const built = buildIndodaxServer(loadEnv({ DATABASE_URL: undefined }));
  built.app.scheduler.stopAll();
  built.app.accountClient = {
    getAccount: async () => ({
      canTrade: true,
      canWithdraw: false,
      balances: [
        { asset: "IDR", free: "10000", locked: "0" },
        { asset: "RAD", free: "5", locked: "0" },
        { asset: "GHOST", free: "7", locked: "0" },
      ],
    }),
  } as unknown as NonNullable<typeof built.app.accountClient>;
  built.app.publicClient = {
    pairs: async () => PAIRS,
    ticker: async (pair: string) => {
      const last = prices[pair] ?? "0";
      return { high: last, low: last, last, buy: last, sell: last };
    },
  } as unknown as PublicClient;
  clearCache();
  return built;
}

describe("live positions", () => {
  it("values a priced leg and withholds totals when a leg has no market", async () => {
    const { server } = stubbed({ rad_idr: "2000" });
    const harness = await withInMemoryServer(server);
    try {
      const r = (await harness.client.callTool({
        name: "indodax_positions_live",
        arguments: {},
      })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError).not.toBe(true);
      interface Leg {
        asset: string;
        valueIdr: string | null;
        pair: string | null;
        unpricedReason: string | null;
        weightPct: string | null;
      }
      const d = JSON.parse(r.content[0]!.text).data as {
        legs: Leg[];
        totalIdr: string | null;
        incomplete: string[];
        pricedLegs: number;
        totalLegs: number;
      };
      const rad = d.legs.find((l) => l.asset === "rad");
      expect(rad?.valueIdr).toBe("10000");
      expect(rad?.pair).toBe("rad_idr");
      const ghost = d.legs.find((l) => l.asset === "ghost");
      // Never zero: zero reads as a total loss rather than an absent market.
      expect(ghost?.valueIdr).toBeNull();
      expect(ghost?.unpricedReason).toContain("no direct ghost_idr market");
      expect(d.incomplete).toEqual(["ghost"]);
      // Weight withheld because one leg is unpriced.
      expect(d.totalIdr).toBeNull();
      expect(d.legs.every((l) => l.weightPct === null)).toBe(true);
      // IDR and RAD are both priced; only GHOST lacks a market.
      expect(d.pricedLegs).toBe(2);
      expect(d.totalLegs).toBe(3);
    } finally {
      await harness.close();
    }
  });

  it("reports weights and a total when every leg is priced", async () => {
    const built = stubbed({ rad_idr: "2000" });
    built.app.accountClient = {
      getAccount: async () => ({
        canTrade: true,
        canWithdraw: false,
        balances: [
          { asset: "IDR", free: "10000", locked: "0" },
          { asset: "RAD", free: "5", locked: "0" },
        ],
      }),
    } as unknown as NonNullable<typeof built.app.accountClient>;
    const harness = await withInMemoryServer(built.server);
    try {
      const r = (await harness.client.callTool({
        name: "indodax_positions_live",
        arguments: {},
      })) as { content: { text: string }[] };
      const d = JSON.parse(r.content[0]!.text).data as {
        totalIdr: string | null;
        legs: { asset: string; weightPct: string | null }[];
      };
      expect(d.totalIdr).toBe("20000");
      const rad = d.legs.find((l) => l.asset === "rad");
      expect(rad?.weightPct).toBe("50.00");
    } finally {
      await harness.close();
    }
  });

  it("refuses without credentials instead of reporting nothing", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.accountClient = null;
    const { server } = built;
    const harness = await withInMemoryServer(server);
    try {
      const r = (await harness.client.callTool({
        name: "indodax_positions_live",
        arguments: {},
      })) as { content: { text: string }[]; isError?: boolean };
      // The guard throws before any body is produced, so the envelope is not
      // available; the transport flag is the observable signal.
      expect(r.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
