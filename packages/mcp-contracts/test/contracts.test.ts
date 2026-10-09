import { describe, expect, it } from "vitest";
import { auditClassSchema, toolMetadataSchema } from "@d1zzy4-jethools/mcp-contracts";

describe("mcp-contracts", () => {
  it("validates tool metadata", () => {
    const parsed = toolMetadataSchema.safeParse({
      name: "system_health",
      title: "System health",
      description: "Read-only service health with checks.",
      capability: "SYSTEM",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects short descriptions", () => {
    const parsed = auditClassSchema.safeParse("bogus");
    expect(parsed.success).toBe(false);
  });
});
