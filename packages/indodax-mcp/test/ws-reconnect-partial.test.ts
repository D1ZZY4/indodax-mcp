/**
 * Regression for partial success in indodax_ws_reconnect.
 *
 * The market and private legs run independently and each records its own
 * failure reason, but the private leg raised its credential error outside its
 * own try/catch. With scope "all" and no credentials the market leg had
 * already reconnected, yet the call reported total failure and discarded the
 * result, leaving the caller unable to tell a real failure from a partial one.
 */
import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

/** No credentials, so the private leg cannot run. */
function stubbed() {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  let reconnected = 0;
  built.app.marketSocket.reconnectWithResubscribe = async () => {
    reconnected += 1;
    return [{ channel: "market:summary-24h", lastOffset: 7 }];
  };
  return { built, reconnected: () => reconnected };
}

async function reconnect(harness: Harness, scope: "market" | "private" | "all") {
  const result = (await harness.client.callTool({
    name: "indodax_ws_reconnect",
    arguments: { scope },
  })) as { content: { text: string }[]; isError?: boolean };
  return JSON.parse(result.content[0]?.text ?? "{}") as {
    status: string;
    message?: string;
    data?: {
      reconnected: boolean;
      connected: string[];
      restored: string[];
      reasons?: string[];
      partial?: boolean;
    };
  };
}

describe("ws reconnect reports partial success", () => {
  it("keeps the market result when the private leg cannot run", async () => {
    const { built, reconnected } = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await reconnect(harness, "all");
      expect(reconnected()).toBe(1);
      expect(body.status).toBe("ok");
      expect(body.data?.connected).toEqual(["market"]);
      expect(body.data?.restored).toEqual(["market:summary-24h"]);
      // The private leg failed, and the reason is stated rather than thrown
      // over the successful market leg.
      expect(body.data?.reasons?.join(" ")).toContain("private");
      expect(body.data?.reasons?.join(" ")).toContain("credentials");
      // One of the two requested legs succeeded, so the result is partial.
      expect(body.data?.partial).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("reports no connection when the requested leg is private and cannot run", async () => {
    // A private-only request that cannot run reports reconnected false with the
    // reason, rather than an empty success that looks like a live channel.
    const { built } = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await reconnect(harness, "private");
      expect(body.data?.connected).toEqual([]);
      expect(body.data?.reconnected).toBe(false);
      expect(body.data?.reasons?.join(" ")).toContain("credentials");
      // Not partial: the single requested leg is the one that failed.
      expect(body.data?.partial).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("reports only the market leg when scoped to market", async () => {
    const { built, reconnected } = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await reconnect(harness, "market");
      expect(reconnected()).toBe(1);
      expect(body.status).toBe("ok");
      expect(body.data?.connected).toEqual(["market"]);
      expect(body.data?.reasons).toBeUndefined();
    } finally {
      await harness.close();
    }
  });
});
