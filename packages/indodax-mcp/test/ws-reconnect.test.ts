import { describe, expect, it } from "vitest";
import { loadEnv } from "@d1zzy4-jethools/config";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";

function textOf(result: { content: { text: string }[] }): string {
  const block = result.content.at(0);
  if (block === undefined) throw new Error("expected a text content block");
  return block.text;
}

describe("ws reconnect reporting", () => {
  it("reports connected when the socket connects with nothing to restore", async () => {
    // Regression for the false+CONNECTED contradiction: reconnected used to
    // count restored subscriptions, so a healthy socket with no subscriptions
    // reported failure next to a connected state.
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.marketSocket.reconnectWithResubscribe = async () => [];
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_ws_reconnect",
        arguments: { scope: "market" },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (JSON.parse(textOf(result)) as { data: Record<string, unknown> }).data as {
        reconnected: boolean;
        connected: string[];
        restored: string[];
      };
      expect(data.reconnected).toBe(true);
      expect(data.connected).toEqual(["market"]);
      expect(data.restored).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("reports failure with reasons when the socket cannot connect", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.marketSocket.reconnectWithResubscribe = async () => {
      throw new Error("dial refused");
    };
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_ws_reconnect",
        arguments: { scope: "market" },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (JSON.parse(textOf(result)) as { data: Record<string, unknown> }).data as {
        reconnected: boolean;
        reasons: string[];
      };
      expect(data.reconnected).toBe(false);
      expect(data.reasons.join(" ")).toContain("dial refused");
    } finally {
      await harness.close();
    }
  });

  it("masks the private channel hash in status output", async () => {
    const built = buildIndodaxServer(loadEnv({ INDODAX_API_KEY: "k", INDODAX_API_SECRET: "s" }));
    built.app.scheduler.stopAll();
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_ws_status",
        arguments: {},
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (JSON.parse(textOf(result)) as { data: Record<string, unknown> }).data as {
        private: { channel: string | null };
      };
      // Disconnected without a channel: null stays null, never a crash.
      expect(data.private.channel).toBeNull();
    } finally {
      await harness.close();
    }
  });
});
