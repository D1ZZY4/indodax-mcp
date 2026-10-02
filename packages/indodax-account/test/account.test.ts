import { describe, expect, it } from "vitest";
import type { FetchFn } from "@indodax-mcp/transport";
import { AccountClient, capabilitiesFor, toBalanceViews } from "../src/index.js";
import { TapiV2Signer } from "@indodax-mcp/indodax-auth";

const ACCOUNT = {
  canTrade: true,
  canWithdraw: false,
  accountType: "Regular",
  balances: [
    { asset: "BTC", free: "1.5", locked: "0.5" },
    { asset: "IDR", free: "100000", locked: "0" },
  ],
  uid: 7,
};

describe("indodax-account", () => {
  it("parses balances and totals with Decimal", () => {
    const views = toBalanceViews({
      canTrade: true,
      canWithdraw: false,
      balances: ACCOUNT.balances,
    });
    expect(views.find((view) => view.asset === "btc")?.total).toBe("2");
  });

  it("maps permissions to capabilities without withdraw", () => {
    expect(capabilitiesFor({ canTrade: true, canWithdraw: false, balances: [] })).toEqual([
      "READ",
      "PAPER",
      "TRADE",
    ]);
  });

  it("fetches account with signed headers", async () => {
    let seenHeaders: Record<string, string> = {};
    const fetchFn = (async (_input: string, init?: RequestInit) => {
      seenHeaders = { ...((init?.headers ?? {}) as Record<string, string>) };
      return new Response(JSON.stringify(ACCOUNT));
    }) as FetchFn;
    const client = new AccountClient({ signer: new TapiV2Signer("k", "s"), fetchFn });
    const account = await client.getAccount();
    expect(account.canTrade).toBe(true);
    expect(seenHeaders["X-APIKEY"]).toBe("k");
    expect(seenHeaders.Sign).toHaveLength(64);
  });
});
