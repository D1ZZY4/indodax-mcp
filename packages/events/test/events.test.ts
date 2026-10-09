import { describe, expect, it } from "vitest";
import { EventBus } from "@indodax-mcp/events";

describe("event bus", () => {
  it("delivers typed events to subscribers", async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.on("risk.allowed", (event) => {
      if (event.kind === "risk.allowed") seen.push(event.correlationId);
    });
    await bus.publish({ kind: "risk.allowed", correlationId: "c1", at: new Date().toISOString() });
    await bus.publish({
      kind: "risk.denied",
      correlationId: "c2",
      reason: "x",
      at: new Date().toISOString(),
    });
    expect(seen).toEqual(["c1"]);
    off();
  });
});
