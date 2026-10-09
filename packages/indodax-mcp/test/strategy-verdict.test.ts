import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

/**
 * A scan over many pairs met a thin market and got a ValidationError it had to
 * catch, then rendered `NaN%` for a percentage derived from an absent signal.
 * A thin pair is a normal screener outcome, so it is reported in the success
 * envelope with an explicit verdict and null signal fields.
 */

type Envelope = {
  status: string;
  data: Record<string, unknown>;
  code?: string;
  message?: string;
};

async function call(
  harness: Awaited<ReturnType<typeof withInMemoryServer>>,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; envelope: Envelope }> {
  const result = (await harness.client.callTool({
    name: "indodax_strategy_evaluate",
    arguments: args,
  })) as { content: { type: string; text: string }[]; isError?: boolean };
  return {
    isError: result.isError === true,
    envelope: JSON.parse(result.content[0]?.text ?? "{}") as Envelope,
  };
}

function build() {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  return built;
}

const RISES = [100, 102, 104, 106, 108, 110, 112, 114];

describe("strategy signal verdicts", () => {
  it("marks a thin market as insufficient data instead of failing", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const { isError, envelope } = await call(harness, {
        pair: "cng_idr",
        closes: [6105, 6200],
        window: 8,
      });
      expect(isError).toBe(false);
      expect(envelope.data.verdict).toBe("insufficient_data");
      expect(envelope.data.side).toBeNull();
      expect(envelope.data.strength).toBeNull();
      expect(envelope.data.closesNeeded).toBe(8);
      expect(String(envelope.data.note)).toContain("do not read this as a neutral signal");
    } finally {
      await harness.close();
    }
  });

  it("reports a usable signal with an ok verdict", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const { isError, envelope } = await call(harness, { pair: "btc_idr", closes: RISES });
      expect(isError).toBe(false);
      expect(envelope.data.verdict).toBe("ok");
      expect(envelope.data.side).toBe("BUY");
      expect(envelope.data.strength).toBeGreaterThan(0);
      expect(typeof envelope.data.strength).toBe("number");
    } finally {
      await harness.close();
    }
  });

  it("still rejects a genuinely malformed request", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const { isError, envelope } = await call(harness, { pair: "btc_idr", closes: [100] });
      expect(isError).toBe(true);
      expect(envelope.code).toBe("ValidationError");
      expect(envelope.message).toContain("at least two numbers");
    } finally {
      await harness.close();
    }
  });

  it("points an empty closes array at the extraction path", async () => {
    // A real loop passed data[].Close (capital C) and got closes: [].
    // The error must name the correct lowercase path instead of reading as
    // an exchange failure downstream.
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const { isError, envelope } = await call(harness, { pair: "btc_idr", closes: [] });
      expect(isError).toBe(true);
      expect(envelope.message).toContain("data.bars[].close");
      const backtest = (await harness.client.callTool({
        name: "indodax_backtest_run",
        arguments: { closes: [] },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(backtest.isError).toBe(true);
      expect(backtest.content.map((block) => block.text).join("\n")).toContain("data.bars[].close");
      const validated = (await harness.client.callTool({
        name: "indodax_strategy_validate",
        arguments: { id: "ma-cross", closes: [] },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(validated.isError).not.toBe(true);
      expect(validated.content.map((block) => block.text).join("\n")).toContain(
        "data.bars[].close",
      );
    } finally {
      await harness.close();
    }
  });

  it("still rejects non-positive prices at the schema boundary", async () => {
    // The declared input schema already refuses a non-positive close, so this
    // is a protocol-level rejection rather than the envelope above. Asserting
    // the real path keeps the test honest instead of asserting a shape the
    // harness never produces.
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_strategy_evaluate",
        arguments: { pair: "btc_idr", closes: [100, 0, 0, 0] },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      const text = result.content.map((block) => block.text).join("\n");
      expect(text).toContain("closes");
      expect(text).toMatch(/Too small|>0/i);
    } finally {
      await harness.close();
    }
  });

  it("keeps the strategy validation tool strict", async () => {
    // indodax_strategy_validate is the tool for rejecting inputs, so it must
    // still report a too-narrow window as an error rather than a soft verdict.
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_strategy_validate",
        arguments: { id: "ma-cross", closes: [6105, 6200], window: 8 },
      })) as { content: { text: string }[]; isError?: boolean };
      const envelope = JSON.parse(result.content[0]?.text ?? "{}") as {
        data: { valid: boolean; errors: string[] };
      };
      expect(envelope.data.valid).toBe(false);
      expect(envelope.data.errors.join(" ")).toContain("window must fit inside closes");
    } finally {
      await harness.close();
    }
  });
});
