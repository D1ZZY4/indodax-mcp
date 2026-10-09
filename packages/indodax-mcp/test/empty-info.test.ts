import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

interface Envelope {
  status: string;
  data: unknown;
  warnings?: string[];
}

async function envelopeOf(call: Promise<unknown>): Promise<Envelope> {
  const result = (await call) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as Envelope;
}

describe("empty and informational responses", () => {
  it("says empty audit means no activity, not failure", async () => {
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const events = await envelopeOf(
        harness.client.callTool({ name: "indodax_audit_events", arguments: {} }),
      );
      const eventData = events.data as { count: number; total: number; entries: unknown[] };
      expect(eventData.count).toBe(0);
      expect(eventData.entries).toEqual([]);
      expect(events.warnings ?? []).toContain(
        "audit trail is empty: no activity recorded yet in this session, not a failure",
      );
      const trace = await envelopeOf(
        harness.client.callTool({
          name: "indodax_execution_trace",
          arguments: { correlationId: "never-seen" },
        }),
      );
      const traceData = trace.data as { count: number; trace: unknown[] };
      expect(traceData.count).toBe(0);
      expect(traceData.trace).toEqual([]);
      expect(trace.warnings?.[0] ?? "").toContain("never-seen");
    } finally {
      await harness.close();
    }
  });

  it("labels cross-ledger mismatch as informational", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.accountClient = {
      getAccount: async () => ({
        canTrade: false,
        canWithdraw: false,
        balances: [{ asset: "IDR", free: "1", locked: "0" }],
      }),
    } as unknown as NonNullable<typeof built.app.accountClient>;
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await envelopeOf(
        harness.client.callTool({ name: "indodax_reconcile_balances", arguments: {} }),
      );
      const data = body.data as { balances: { state: string }[]; note: string };
      expect(data.balances[0]?.state).toBe("MISMATCH");
      expect(data.note).toContain("different, not broken");
    } finally {
      await harness.close();
    }
  });
});
