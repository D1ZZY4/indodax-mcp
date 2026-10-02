import { describe, expect, it } from "vitest";
import { AuditTrail } from "../src/index.js";

describe("audit", () => {
  it("records and traces by correlation", () => {
    const trail = new AuditTrail();
    trail.record({ kind: "AgentIntentCreated", correlationId: "c1" });
    trail.record({ kind: "RiskApproved", correlationId: "c1" });
    trail.record({ kind: "AgentIntentCreated", correlationId: "c2" });
    expect(trail.length).toBe(3);
    expect(trail.trace("c1")).toHaveLength(2);
  });
});
