import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "@d1zzy4-jethools/config";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";

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

  it("unifies a legacy key-version refusal as FUNDING_UNAUTHORIZED", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ success: 0, error: "Access denied for this API key version" }),
        ),
    );
    const { server } = liveApp();
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_withdraw_fee",
        arguments: { currency: "btc" },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      const body = JSON.parse(result.content[0]?.text ?? "{}") as {
        code: string;
        message: string;
        safeMetadata?: { reason?: string; haveGrant?: boolean; tool?: string };
      };
      expect(body.message).toContain("FUNDING_UNAUTHORIZED");
      expect(body.message.match(/FUNDING_UNAUTHORIZED/g)).toHaveLength(1);
      expect(body.safeMetadata?.reason).toBe("FUNDING_UNAUTHORIZED");
      expect(body.safeMetadata?.haveGrant).toBe(false);
      expect(body.safeMetadata?.tool).toBe("indodax_withdraw_fee");
    } finally {
      await harness.close();
    }
  });

  it("keeps IP refusals on their richer remedy instead of relabeling them", async () => {
    const { server } = liveApp();
    const harness = await withInMemoryServer(server);
    try {
      const failure = await errorOf(harness, "indodax_withdraw_history", { coin: "btc" });
      expect(failure.message).toContain("allowlist");
      expect(failure.message).not.toContain("FUNDING_UNAUTHORIZED");
    } finally {
      await harness.close();
    }
  });

  it("redirects fiat coin codes to fiat history before any network call", async () => {
    const { server } = liveApp();
    const harness = await withInMemoryServer(server);
    try {
      const failure = await errorOf(harness, "indodax_deposit_history", { coin: "idr" });
      expect(failure.code).toBe("ValidationError");
      expect(failure.message).toContain("indodax_fiat_history");
    } finally {
      await harness.close();
    }
  });

  it("marks a successful address list as permitted reads", async () => {
    stubFetch(() => new Response(JSON.stringify([])));
    const { server } = liveApp();
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_deposit_address",
        arguments: { coin: "BTC", network: "BTC" },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (
        JSON.parse(result.content[0]?.text ?? "{}") as {
          data: { permitted: boolean; count: number };
        }
      ).data;
      expect(data.permitted).toBe(true);
      expect(data.count).toBe(0);
    } finally {
      await harness.close();
    }
  });
});
