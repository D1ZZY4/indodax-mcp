import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

interface Envelope {
  status: string;
  data: {
    proposal: string;
    order: { state: string };
    decision: { outcome: string };
    executed: boolean;
  };
  warnings?: string[];
  fetchedAt: string;
}

async function envelopeOf(call: Promise<unknown>): Promise<Envelope> {
  const result = (await call) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as Envelope;
}

describe("proposal safety", () => {
  it.each([
    ["indodax_validate_order", { pair: "btc_idr", side: "BUY", quantity: 100, price: 1000 }],
    ["indodax_propose_order", { pair: "btc_idr", side: "BUY", quantity: 100, price: 1000 }],
  ] as [string, Record<string, unknown>][])(
    "%s is unmistakably not an order",
    async (name, args) => {
      const { server } = buildIndodaxServer(loadEnv({}));
      const harness = await withInMemoryServer(server);
      try {
        const body = await envelopeOf(harness.client.callTool({ name, arguments: args }));
        expect(body.data.executed).toBe(false);
        expect(body.data.order.state).toBe("PROPOSED");
        expect(body.data.order.state).not.toBe("ACCEPTED");
        expect(body.warnings ?? []).toContain(
          "proposal only: nothing was placed and no funds moved",
        );
      } finally {
        await harness.close();
      }
    },
  );

  it.each(["shadow", "development"] as const)(
    "create_order with reserved mode %s never reaches a backend",
    async (mode) => {
      const { server, app } = buildIndodaxServer(loadEnv({}));
      const before = app.paper.snapshot().tradeCount;
      const harness = await withInMemoryServer(server);
      try {
        const result = await harness.client.callTool({
          name: "indodax_create_order",
          arguments: { pair: "btc_idr", side: "BUY", quantity: 100, price: 1000, mode },
        });
        expect(result.isError).toBe(true);
        expect(app.paper.snapshot().tradeCount).toBe(before);
      } finally {
        await harness.close();
      }
    },
  );

  it.each(["shadow", "development"] as const)(
    "cancel_order with reserved mode %s is denied, not treated as paper",
    async (mode) => {
      const { server } = buildIndodaxServer(loadEnv({}));
      const harness = await withInMemoryServer(server);
      try {
        const result = await harness.client.callTool({
          name: "indodax_cancel_order",
          arguments: { orderId: "paper-1", mode },
        });
        expect(result.isError).toBe(true);
      } finally {
        await harness.close();
      }
    },
  );

  it("validate_order shows the exact quantity it was given", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.publicClient = {
      ticker: async () => ({ high: "1", low: "1", last: "1", buy: "1", sell: "1" }),
      pairs: async () => [
        {
          id: "mubarakidr",
          symbol: "MUBARAKIDR",
          base_currency: "idr",
          traded_currency: "mubarak",
          ticker_id: "mubarak_idr",
          quantity_increment: "1",
        },
      ],
    } as unknown as PublicClient;
    clearCache();
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_validate_order",
        arguments: { pair: "mubarak_idr", side: "BUY", quantity: 13.4, price: 1000 },
      })) as { content: { type: string; text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const body = JSON.parse(result.content[0]?.text ?? "{}") as {
        warnings?: string[];
        data: { order: { quantity: string } };
      };
      // validate_order is hypothetical: it reports the shape it was given and
      // places nothing. Rounding happens on the placement path, so the proposal
      // still shows 13.4 and must not claim it was rounded.
      expect(body.data.order.quantity).toBe("13.4");
      expect(body.warnings?.join(" ") ?? "").not.toContain("rounded");
    } finally {
      await harness.close();
    }
  });
});
