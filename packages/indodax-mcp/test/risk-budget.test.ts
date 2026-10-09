import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { loadEnv } from "@d1zzy4-jethools/config";
import type { PublicClient } from "@d1zzy4-jethools/indodax-client";
import { clearCache } from "@d1zzy4-jethools/indodax-market";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";
import { assessBudgetSize, assessStopRisk } from "@d1zzy4-jethools/mcp-app/risk-budget";

const PAIRS = [
  {
    id: "novaidr",
    symbol: "NOVAIDR",
    ticker_id: "nova_idr",
    base_currency: "idr",
    traded_currency: "nova",
    quantity_increment: "1",
    price_precision: "0",
    trade_min_base_currency: "10000",
    trade_min_traded_currency: "1",
  },
];

function stubbed() {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  built.app.publicClient = {
    pairs: async () => PAIRS,
    ticker: async () => ({
      high: "14000",
      low: "13000",
      last: "13500",
      buy: "13400",
      sell: "13600",
    }),
  } as unknown as PublicClient;
  clearCache();
  return built;
}

function textOf(result: { content: { text: string }[] }): string {
  const block = result.content.at(0);
  if (block === undefined) throw new Error("expected a text content block");
  return block.text;
}

function dataOf(result: { content: { text: string }[]; isError?: boolean }) {
  expect(result.isError).not.toBe(true);
  return (JSON.parse(textOf(result)) as { data: Record<string, unknown> }).data;
}

/**
 * Two layers, two jobs: the notional multiple is sizing information that
 * never warns (every placeable order on a small account exceeds a 1%
 * budget by construction), while the stop-distance multiple is the real
 * planned loss and warns above 1x.
 */
describe("risk budget assessment", () => {
  it("reports nulls when no budget is supplied", () => {
    expect(assessBudgetSize(new Decimal("100000"), undefined)).toEqual({
      riskBudget: null,
      notionalMultiple: null,
    });
    expect(
      assessStopRisk({
        price: new Decimal("100"),
        stopPrice: 90,
        quantity: new Decimal("1"),
        budget: undefined,
      }),
    ).toMatchObject({ riskMultiple: null, riskWarning: null });
  });

  it("reports the notional multiple as info without warning", async () => {
    // Live case: 1 unit at 13583 against a 1451 budget is 9.36x notional.
    // That is normal sizing info on a small account, not a danger signal,
    // so the verdict stays ALLOW with no warning and guidance toward a
    // stop-based assessment instead.
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const data = dataOf(
        (await harness.client.callTool({
          name: "indodax_validate_order",
          arguments: { pair: "nova_idr", side: "BUY", quantity: 1, price: 13583, riskBudget: 1451 },
        })) as { content: { text: string }[]; isError?: boolean },
      );
      expect(data.decision).toMatchObject({ outcome: "ALLOW" });
      expect(data.notionalMultiple).toBe(9.36);
      expect(data.riskBudget).toBe("1451");
      expect(data.riskMultiple).toBeNull();
      expect(data.riskWarning).toBeNull();
      expect(data.riskNote).toContain("stopPrice");
    } finally {
      await harness.close();
    }
  });

  it("warns when the planned stop loss exceeds the budget", async () => {
    // Entry 13583 with a stop at 12000 risks 1583 against a 1451 budget.
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_validate_order",
        arguments: {
          pair: "nova_idr",
          side: "BUY",
          quantity: 1,
          price: 13583,
          riskBudget: 1451,
          stopPrice: 12000,
        },
      })) as { content: { text: string }[]; isError?: boolean };
      const body = JSON.parse(textOf(result)) as {
        data: Record<string, unknown>;
        warnings?: string[];
      };
      expect(body.data.riskMultiple).toBe(1.09);
      expect(body.data.riskAmount).toBe("1583");
      expect([...(body.warnings ?? [])].join(" ")).toContain("1.09x");
    } finally {
      await harness.close();
    }
  });

  it("stays quiet when the planned loss fits the budget", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_risk_evaluate",
        arguments: {
          pair: "nova_idr",
          side: "BUY",
          quantity: 1,
          price: 13583,
          riskBudget: 1451,
          stopPrice: 13000,
        },
      })) as { content: { text: string }[]; isError?: boolean };
      const body = JSON.parse(textOf(result)) as {
        data: Record<string, unknown>;
        warnings?: string[];
      };
      expect(body.data.outcome).toBe("ALLOW");
      expect(body.data.riskMultiple).toBe(0.4);
      expect(body.data.riskWarning).toBeNull();
      expect(body.warnings ?? []).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it("warns when the pair minimum alone exceeds the budget", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_round_order",
        arguments: { pair: "nova_idr", quantity: 1, price: 13583, riskBudget: 1451 },
      })) as { content: { text: string }[]; isError?: boolean };
      const body = JSON.parse(textOf(result)) as {
        data: Record<string, unknown>;
        warnings?: string[];
      };
      expect(body.data.notionalMultiple).toBe(9.36);
      expect([...(body.warnings ?? [])].join(" ")).toContain("pair minimum notional");
    } finally {
      await harness.close();
      clearCache();
    }
  });
});
