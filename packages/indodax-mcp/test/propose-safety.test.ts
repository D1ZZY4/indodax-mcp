import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "../src/index.js";

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
});
