import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { assessRiskBudget } from "@indodax-mcp/indodax-mcp/risk-budget";

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

describe("risk budget assessment", () => {
  it("reports nulls when no budget is supplied", () => {
    expect(assessRiskBudget(new Decimal("100000"), undefined)).toEqual({
      riskBudget: null,
      riskMultiple: null,
      riskWarning: null,
    });
  });

  it("flags a notional far above the budget without changing the verdict", async () => {
    // Live case: 1 unit at 13583 against a 1451 budget is 9.3x. Limits still
    // pass, so the verdict stays ALLOW and the warning carries the sizing
    // refusal instead.
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
      expect(data.riskMultiple).toBe(9.36);
      expect(data.riskBudget).toBe("1451");
      expect(data.riskWarning).toContain("9.36x");
    } finally {
      await harness.close();
    }
  });

  it("adds the multiple to risk_evaluate alongside the verdict", async () => {
    const { server } = stubbed();
    const harness = await withInMemoryServer(server);
    try {
      const data = dataOf(
        (await harness.client.callTool({
          name: "indodax_risk_evaluate",
          arguments: { pair: "nova_idr", side: "BUY", quantity: 1, price: 13583, riskBudget: 1451 },
        })) as { content: { text: string }[]; isError?: boolean },
      );
      expect(data.outcome).toBe("ALLOW");
      expect(data.riskMultiple).toBe(9.36);
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
      expect(body.data.riskMultiple).toBe(9.36);
      expect([...(body.warnings ?? [])].join(" ")).toContain("pair minimum notional");
    } finally {
      await harness.close();
      clearCache();
    }
  });
});
