import { describe, expect, it } from "vitest";
import type { FetchFn } from "@d1zzy4-jethools/transport";
import { AccountClient, capabilitiesFor, toBalanceViews } from "@d1zzy4-jethools/indodax-account";
import { TapiV2Signer } from "@d1zzy4-jethools/indodax-auth";

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

  it("names a missing order instead of surfacing raw transport text", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ code: -2011, msg: "Order does not exist" }), {
        status: 404,
      })) as FetchFn;
    const client = new AccountClient({ signer: new TapiV2Signer("k", "s"), fetchFn });
    const error = await client.getOrder("btc_idr", "nope").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as { code?: string }).code).toBe("OrderRejectedError");
    expect((error as Error).message).toContain("-2011");
    expect((error as { safeMetadata?: { reason?: string } }).safeMetadata?.reason).toBe(
      "order_not_found",
    );
  });

  it("tells a completed order apart from a missing one", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ code: -2012, msg: "Order already completed" }), {
        status: 400,
      })) as FetchFn;
    const client = new AccountClient({ signer: new TapiV2Signer("k", "s"), fetchFn });
    const error = await client.getOrder("btc_idr", "done").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as { safeMetadata?: { reason?: string } }).safeMetadata?.reason).toBe(
      "order_already_completed",
    );
    expect((error as Error).message).toContain("do not retry");
  });

  it("still names an unknown order code instead of raw transport text", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ code: -9999, msg: "Something novel" }), {
        status: 400,
      })) as FetchFn;
    const client = new AccountClient({ signer: new TapiV2Signer("k", "s"), fetchFn });
    const error = await client.getOrder("btc_idr", "weird").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as { code?: string }).code).toBe("OrderRejectedError");
    expect((error as Error).message).toContain("-9999");
    expect((error as Error).message).toContain("do not retry the same request unchanged");
    expect((error as Error).message).not.toContain("unexpected HTTP");
  });

  it("keeps the read error code while adding the remedy", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ code: -2015, msg: "Unauthorized IP address." }), {
        status: 403,
      })) as FetchFn;
    const client = new AccountClient({ signer: new TapiV2Signer("k", "s"), fetchFn });
    const error = await client.getAccount().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as { code?: string }).code).toBe("ExchangeApiError");
    expect((error as Error).message).toContain("-2015");
    expect((error as Error).message).toContain("allowlist");
    expect((error as { safeMetadata?: { reason?: string } }).safeMetadata?.reason).toBe(
      "ip_not_allowlisted",
    );
  });

  it("acquires the private rate-limit slot per call", async () => {
    const { RateLimiter } = await import("@d1zzy4-jethools/transport");
    const fetchFn = (async () => new Response(JSON.stringify(ACCOUNT))) as FetchFn;
    const limiter = new RateLimiter([{ key: "v2-rest", capacity: 10, refillPerSecond: 10 }]);
    const client = new AccountClient({ signer: new TapiV2Signer("k", "s"), fetchFn, limiter });
    await client.getAccount();
    expect(limiter.remaining("v2-rest")).toBe(9);
  });

  it("rebuilds the account signature on every retry attempt", async () => {
    // A single signature reused across retries expires outside recvWindow and
    // turns a transient 500 into a permanent timestamp rejection. The account
    // read must re-sign per attempt like the other signed reads.
    const signer = new TapiV2Signer("k", "s");
    let timestampCalls = 0;
    const original = signer.buildTimestampParams.bind(signer);
    signer.buildTimestampParams = (extra: Record<string, string>, nowMs?: number) => {
      timestampCalls += 1;
      return original(extra, nowMs);
    };
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      if (calls === 1) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify(ACCOUNT));
    }) as FetchFn;
    const client = new AccountClient({ signer, fetchFn });
    const account = await client.getAccount();
    expect(account.canTrade).toBe(true);
    expect(calls).toBe(2);
    expect(timestampCalls).toBeGreaterThanOrEqual(2);
  });
});

describe("indodax-account symbol normalization", () => {
  async function seenUrl(call: (client: AccountClient) => Promise<unknown>): Promise<string> {
    let seen = "";
    const fetchFn = (async (input: string) => {
      seen = String(input);
      return new Response(JSON.stringify(ACCOUNT));
    }) as FetchFn;
    const client = new AccountClient({ signer: new TapiV2Signer("k", "s"), fetchFn });
    await call(client).catch(() => null);
    return seen;
  }

  it("sends the uppercase compact spelling for order reads", async () => {
    expect(await seenUrl((client) => client.getOrder("w3f_idr", "1"))).toContain("symbol=W3FIDR");
    expect(await seenUrl((client) => client.openOrders("w3f_idr"))).toContain("symbol=W3FIDR");
  });

  it("sends the lowercase compact spelling for history reads", async () => {
    expect(await seenUrl((client) => client.orderHistories({ symbol: "W3F_IDR" }))).toContain(
      "symbol=w3fidr",
    );
    expect(await seenUrl((client) => client.myTrades({ symbol: "w3f_idr" }))).toContain(
      "symbol=w3fidr",
    );
  });
});
