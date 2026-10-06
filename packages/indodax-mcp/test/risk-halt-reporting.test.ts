import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { checkPaperConsistency } from "@indodax-mcp/indodax-mcp/paper-consistency";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

async function dataOf(harness: Harness, name: string, args: Record<string, unknown> = {}) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return (
    JSON.parse(result.content[0]?.text ?? "{}") as {
      data: {
        halted: boolean;
        haltReason: string | null;
        reconciliationHalted: boolean;
        deadmanHalted?: boolean;
        deadman: { state: string };
        state: string;
        checkedOrders: number;
      };
    }
  ).data;
}

/**
 * `halted` and `haltReason` are the fields an operator or agent reads to decide
 * whether the trading path is open. The deadman state was excluded from them,
 * so an EXPIRED switch reported halted=false while live placement was in fact
 * refused with DEADMAN_UNKNOWN.
 */
describe("risk_state halt reporting", () => {
  it("reports halted with a deadman reason when the deadman expired", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.deadman.arm(["btc_idr"], 60_000);
    built.app.deadman.recordRefreshFailure();
    built.app.deadman.recordRefreshFailure();
    built.app.deadman.recordRefreshFailure();

    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_risk_state");
      expect(data.deadman.state).toBe("EXPIRED");
      expect(data.halted).toBe(true);
      expect(data.haltReason).toBe("deadmanEXPIRED");
      expect(data.deadmanHalted).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("reports halted with a deadman reason when the deadman is stale", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.deadman.arm(["btc_idr"], 60_000);
    built.app.deadman.recordRefreshFailure();

    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_risk_state");
      expect(data.deadman.state).toBe("STALE");
      expect(data.halted).toBe(true);
      expect(data.haltReason).toBe("deadmanSTALE");
    } finally {
      await harness.close();
    }
  });

  it("does not report a halt for an ARMED or DISARMED deadman", async () => {
    // DISARMED is an explicit opt-out and ARMED is healthy, so neither may
    // close the path this way.
    const disarmed = buildIndodaxServer(loadEnv({}));
    disarmed.app.scheduler.stopAll();
    const dHarness = await withInMemoryServer(disarmed.server);
    try {
      const data = await dataOf(dHarness, "indodax_risk_state");
      expect(data.deadman.state).toBe("DISARMED");
      expect(data.halted).toBe(false);
      expect(data.haltReason).toBeNull();
      expect(data.deadmanHalted).toBe(false);
    } finally {
      await dHarness.close();
    }

    const armed = buildIndodaxServer(loadEnv({}));
    armed.app.scheduler.stopAll();
    armed.app.deadman.arm(["btc_idr"], 60_000);
    const aHarness = await withInMemoryServer(armed.server);
    try {
      const data = await dataOf(aHarness, "indodax_risk_state");
      expect(data.halted).toBe(false);
    } finally {
      await aHarness.close();
    }
  });

  it("keeps the reconciliation halt reason ahead of the deadman reason", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.deadman.arm(["btc_idr"], 60_000);
    built.app.deadman.recordRefreshFailure();
    built.app.deadman.recordRefreshFailure();
    built.app.deadman.recordRefreshFailure();
    const now = new Date().toISOString();
    built.app.paper.restore({
      balances: { idr: "100000000", btc: "1" },
      orders: [
        {
          internalOrderId: "corrupt-1",
          clientOrderId: "c1",
          exchangeOrderId: "px1",
          symbol: { base: "btc", quote: "idr" },
          side: "BUY",
          orderType: "LIMIT",
          price: "1000",
          quantity: "10",
          remaining: "99",
          state: "ACCEPTED",
          environment: "paper",
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
    } as never);
    expect(checkPaperConsistency(built.app).state).toBe("MISMATCH");

    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_risk_state");
      expect(data.haltReason).toBe("reconciliationHalted");
      expect(data.reconciliationHalted).toBe(true);
      // The deadman condition is still surfaced even though it is not the
      // primary reason, so neither condition is hidden.
      expect(data.deadmanHalted).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("still leaves the halt verdict derived rather than cached", async () => {
    // The read-only invariant: reporting the deadman must not mutate shared
    // application state.
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.deadman.arm(["btc_idr"], 60_000);
    built.app.deadman.recordRefreshFailure();
    const harness = await withInMemoryServer(built.server);
    try {
      await dataOf(harness, "indodax_risk_state");
      expect(built.app.reconciliationHalted).toBe(false);
    } finally {
      await harness.close();
    }
  });
});
