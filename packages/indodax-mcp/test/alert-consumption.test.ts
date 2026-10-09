/**
 * Regression for the alert false-negative reported from a production loop.
 *
 * The scheduled alert-autopoll and an agent-issued check share one AlertStore.
 * Whichever call runs first retires a matching alert, so the other one finds
 * nothing active. A check that returns only its own transitions therefore
 * reports a zero count for a condition that was in fact met, which reads as
 * "did not trigger" and can lead to a missed or duplicated response.
 */
import { describe, expect, it } from "vitest";
import { loadEnv } from "@d1zzy4-jethools/config";
import type { PublicClient } from "@d1zzy4-jethools/indodax-client";
import { clearCache } from "@d1zzy4-jethools/indodax-market";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";
import { evaluateAlerts } from "@d1zzy4-jethools/mcp-app/tools/alerts";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

function stubbed() {
  clearCache();
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  built.app.publicClient = {
    ticker: async () => ({ high: "200", low: "200", last: "200", buy: "200", sell: "200" }),
    pairs: async () => [],
  } as unknown as PublicClient;
  clearCache();
  return built;
}

async function check(harness: Harness, pair: string) {
  const result = (await harness.client.callTool({
    name: "indodax_alert_check",
    arguments: { pair },
  })) as { content: { text: string }[]; isError?: boolean };
  expect(result.isError).not.toBe(true);
  return (
    JSON.parse(result.content[0]?.text ?? "{}") as {
      data: {
        price: string;
        priceSource: string;
        priceAgeMs: number | null;
        triggeredCount: number;
        alreadyTriggeredCount: number;
        alreadyTriggered: { id: string; status: string; triggeredAt?: string }[];
        remainingActive: number;
        summary: string;
      };
    }
  ).data;
}

describe("alert check reports consumption rather than a false negative", () => {
  it("surfaces an alert the autopoll already retired", async () => {
    const built = stubbed();
    const alert = built.app.alerts.add({
      pair: "btc_idr",
      condition: { type: "above", price: "100" },
    });
    // The scheduled job runs first, exactly as in the reported production loop.
    const autopoll = await evaluateAlerts(built.app);
    expect(autopoll.triggered).toHaveLength(1);
    expect(built.app.alerts.list(true).at(0)?.status).toBe("triggered");

    const harness = await withInMemoryServer(built.server);
    try {
      const data = await check(harness, "btc_idr");
      expect(data.triggeredCount).toBe(0);
      // The condition was met, so the check must say so rather than imply the
      // alert never fired.
      expect(data.alreadyTriggeredCount).toBe(1);
      expect(data.alreadyTriggered[0]?.id).toBe(alert.id);
      expect(data.alreadyTriggered[0]?.triggeredAt).toBeTruthy();
      expect(data.summary).toContain("already triggered earlier");
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("still reports its own transitions separately from earlier ones", async () => {
    const built = stubbed();
    built.app.alerts.add({ pair: "btc_idr", condition: { type: "above", price: "100" } });
    const harness = await withInMemoryServer(built.server);
    try {
      const first = await check(harness, "btc_idr");
      expect(first.triggeredCount).toBe(1);
      expect(first.alreadyTriggeredCount).toBe(1);

      const second = await check(harness, "btc_idr");
      expect(second.triggeredCount).toBe(0);
      expect(second.alreadyTriggeredCount).toBe(1);
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("states the price source so a cached read is visible to the caller", async () => {
    const built = stubbed();
    built.app.alerts.add({ pair: "btc_idr", condition: { type: "above", price: "999" } });
    const harness = await withInMemoryServer(built.server);
    try {
      await check(harness, "btc_idr");
      // Second call is served from the shared ticker cache rather than a fresh
      // exchange read, and the response must say so.
      const cached = await check(harness, "btc_idr");
      expect(cached.priceSource).toBe("cache");
      expect(cached.priceAgeMs).not.toBeNull();
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("reports nothing triggered for a pair whose condition is unmet", async () => {
    const built = stubbed();
    built.app.alerts.add({ pair: "btc_idr", condition: { type: "below", price: "10" } });
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await check(harness, "btc_idr");
      expect(data.triggeredCount).toBe(0);
      expect(data.alreadyTriggeredCount).toBe(0);
      expect(data.remainingActive).toBe(1);
      expect(data.summary).toContain("no alerts triggered");
    } finally {
      await harness.close();
      clearCache();
    }
  });
});
