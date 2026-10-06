import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

function liveApp() {
  const built = buildIndodaxServer(
    loadEnv({
      APP_ENV: "live",
      TRADE_ENABLED: "true",
      INDODAX_API_KEY: "k",
      INDODAX_API_SECRET: "s",
    }),
  );
  built.app.scheduler.stopAll();
  return built;
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", (async (input: string) => handler(String(input))) as typeof fetch);
}

async function errorOf(harness: Harness, name: string, args: Record<string, unknown>) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { code: string; message: string };
}

beforeEach(() => {
  stubFetch((url) => {
    if (url.includes("ipify")) {
      return new Response(url.includes("api6") ? "2001:db8::9" : "203.0.113.7");
    }
    return new Response(JSON.stringify({ code: -2015, msg: "Unauthorized IP address." }), {
      status: 403,
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("funding rejection translation", () => {
  it("names the IP rejection on funding reads instead of raw transport text", async () => {
    const { server } = liveApp();
    const harness = await withInMemoryServer(server);
    try {
      const failure = await errorOf(harness, "indodax_withdraw_history", { coin: "btc" });
      expect(failure.code).toBe("ExchangeApiError");
      expect(failure.message).toContain("-2015");
      expect(failure.message).toContain("allowlist");
      expect(failure.message).toContain("203.0.113.7");
      expect(failure.message).not.toContain("unexpected HTTP");
    } finally {
      await harness.close();
    }
  });

  it("keeps the deposit history path translated the same way", async () => {
    const { server } = liveApp();
    const harness = await withInMemoryServer(server);
    try {
      const failure = await errorOf(harness, "indodax_deposit_history", { coin: "btc" });
      expect(failure.code).toBe("ExchangeApiError");
      expect(failure.message).toContain("Unauthorized IP");
    } finally {
      await harness.close();
    }
  });
});
