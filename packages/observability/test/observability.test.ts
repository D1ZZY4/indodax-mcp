import { describe, expect, it } from "vitest";
import { Counters, HealthTracker } from "../src/index.js";

describe("observability", () => {
  it("rolls component health up to overall status", () => {
    const tracker = new HealthTracker();
    expect(tracker.overall()).toBe("unknown");
    tracker.set("exchangeRest", { status: "healthy" });
    tracker.set("deadman", { status: "halted", detail: "expired" });
    expect(tracker.overall()).toBe("halted");
  });

  it("counts events", () => {
    const counters = new Counters();
    counters.increment("mcp_requests", 2);
    expect(counters.snapshot()).toEqual({ mcp_requests: 2 });
  });
});
