import { describe, expect, it } from "vitest";
import { loadEnv } from "@d1zzy4-jethools/config";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";
import { resolveRiskContext } from "@d1zzy4-jethools/mcp-app/risk-context";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

async function dataOf(harness: Harness, name: string, args: Record<string, unknown> = {}) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { data: never };
}

async function errorOf(harness: Harness, name: string, args: Record<string, unknown> = {}) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { code: string; message: string };
}

/**
 * An open order whose remaining exceeds quantity.
 * Only reachable from a corrupt or hand-edited snapshot, never from the
 * paper executor, which is why the trading gate must tolerate it.
 */
function corruptLedger() {
  const now = new Date().toISOString();
  return {
    balances: { idr: "100000000", btc: "1" },
    orders: [
      {
        internalOrderId: "corrupt-1",
        clientOrderId: "cc1",
        exchangeOrderId: "px1",
        symbol: { base: "btc", quote: "idr" },
        side: "BUY" as const,
        orderType: "LIMIT" as const,
        price: "1000",
        quantity: "10",
        remaining: "99",
        state: "ACCEPTED" as const,
        environment: "paper" as const,
        tenantId: "t",
        exchangeAccountId: "a",
        strategyId: null,
        runId: null,
        riskDecisionId: null,
        submittedAt: now,
        updatedAt: now,
      },
    ],
    nextOrderId: 2,
    tradeCount: 1,
    totalFees: "0",
    initialBalances: { idr: "100000000", btc: "1" },
  };
}

describe("read-only tools never move the trading gate", () => {
  it("reconciliation_state reports the verdict without writing app state", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.paper.restore(corruptLedger());
    expect(built.app.reconciliationHalted).toBe(false);
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await dataOf(harness, "indodax_reconciliation_state");
      const data = body.data as { state: string; halted: boolean; mismatchedOrders: string[] };
      expect(data.state).toBe("MISMATCH");
      expect(data.halted).toBe(true);
      expect(data.mismatchedOrders).toEqual(["corrupt-1"]);
      expect(built.app.reconciliationHalted).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("risk_state derives its halt without writing app state", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.paper.restore(corruptLedger());
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await dataOf(harness, "indodax_risk_state");
      const data = body.data as {
        halted: boolean;
        haltReason: string;
        reconciliationHalted: boolean;
      };
      expect(data.halted).toBe(true);
      expect(data.haltReason).toBe("reconciliationHalted");
      expect(data.reconciliationHalted).toBe(true);
      expect(built.app.reconciliationHalted).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("reconcile_full leaves app state untouched", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.paper.restore(corruptLedger());
    built.app.accountClient = {
      getAccount: async () => ({ canTrade: false, canWithdraw: false, balances: [] }),
      openOrders: async () => [],
      myTrades: async () => ({ data: [] }),
    } as unknown as NonNullable<typeof built.app.accountClient>;
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await dataOf(harness, "indodax_reconcile_full");
      expect((body.data as { paper: { state: string } }).paper.state).toBe("MISMATCH");
      expect(built.app.reconciliationHalted).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("still halts trading at evaluation time on an inconsistent ledger", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.paper.restore(corruptLedger());
    const context = await resolveRiskContext(built.app, { mode: "paper", capability: "PAPER" });
    expect(context.reconciliationHalted).toBe(true);
    const decision = built.app.risk.evaluate(
      { notional: null, quantity: null, price: null, isMarket: false, symbol: "btc_idr" },
      context,
    );
    expect(decision.outcome).toBe("HALT");
    expect(decision.reasons).toContain("RECONCILIATION_FAILURE");
  });
});

describe("guard reports the real blocker", () => {
  it("names live mode before credentials for a live-only tool", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.scheduler.stopAll();
    const harness = await withInMemoryServer(server);
    try {
      const failure = await errorOf(harness, "indodax_deadman_heartbeat", {
        countdownMs: 60000,
        acknowledged: true,
      });
      expect(failure.code).toBe("AuthorizationError");
      expect(failure.message).toContain("live mode");
    } finally {
      await harness.close();
    }
  });

  it("still denies credentials-only tools without credentials", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.scheduler.stopAll();
    const harness = await withInMemoryServer(server);
    try {
      const failure = await errorOf(harness, "indodax_account");
      expect(failure.code).toBe("AuthenticationError");
    } finally {
      await harness.close();
    }
  });
});
