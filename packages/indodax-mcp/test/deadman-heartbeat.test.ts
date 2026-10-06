import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { resetExchangeState } from "@indodax-mcp/indodax-mcp/tools/deadman";

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

function exchangeRefuses() {
  stubFetch((url) => {
    if (url.includes("ipify")) {
      return new Response(url.includes("api6") ? "2001:db8::9" : "203.0.113.7");
    }
    return new Response("Access denied for this API key", { status: 403 });
  });
}

function networkDown() {
  stubFetch(() => {
    throw new Error("connection reset");
  });
}

async function errorOf(harness: Harness, name: string, args: Record<string, unknown>) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { code: string; message: string };
}

async function dataOf(harness: Harness, name: string, args: Record<string, unknown> = {}) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { data: never };
}

beforeEach(() => {
  resetExchangeState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deadman heartbeat access refusal", () => {
  it("leaves the switch untouched instead of counting a lapse", async () => {
    const { app, server } = liveApp();
    app.deadman.arm(["btc_idr"], 120_000);
    exchangeRefuses();
    const harness = await withInMemoryServer(server);
    try {
      const failure = await errorOf(harness, "indodax_deadman_heartbeat", {
        countdownMs: 60_000,
        acknowledged: true,
      });
      expect(failure.code).toBe("AuthorizationError");
      expect(failure.message).toContain("disarm");
      const status = app.deadman.snapshot();
      expect(status.state).toBe("ARMED");
      expect(status.consecutiveFailures).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it("surfaces the unreachable exchange in the status view", async () => {
    const { app, server } = liveApp();
    app.deadman.arm(["btc_idr"], 120_000);
    exchangeRefuses();
    const harness = await withInMemoryServer(server);
    try {
      await errorOf(harness, "indodax_deadman_heartbeat", {
        countdownMs: 60_000,
        acknowledged: true,
      });
      const body = await dataOf(harness, "indodax_deadman_status");
      const data = body.data as {
        state: string;
        exchange: { available: boolean; lastError: string | null };
      };
      expect(data.state).toBe("ARMED");
      expect(data.exchange.available).toBe(false);
      expect(data.exchange.lastError).toContain("Access denied");
    } finally {
      await harness.close();
    }
  });

  it("still counts a genuine transient failure as a lapse", async () => {
    const { app, server } = liveApp();
    app.deadman.arm(["btc_idr"], 120_000);
    networkDown();
    const harness = await withInMemoryServer(server);
    try {
      const failure = await errorOf(harness, "indodax_deadman_heartbeat", {
        countdownMs: 60_000,
        acknowledged: true,
      });
      expect(failure.code).not.toBe("AuthorizationError");
      const status = app.deadman.snapshot();
      expect(status.state).toBe("STALE");
      expect(status.consecutiveFailures).toBe(1);
    } finally {
      await harness.close();
    }
  });
});
