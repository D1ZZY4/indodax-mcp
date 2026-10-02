import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Registry } from "../src/index.js";

function tool(name: string) {
  return {
    metadata: {
      name,
      title: name,
      description: "A sufficiently long tool description here.",
      capability: "SYSTEM" as const,
      riskClass: "read" as const,
      environmentRequirement: "any" as const,
      authRequirement: "none" as const,
      destructive: false,
      idempotencyClass: "none" as const,
      auditClass: "read" as const,
    },
    inputSchema: z.object({}),
  };
}

describe("registry", () => {
  it("registers and lists tools", () => {
    const registry = new Registry();
    registry.registerTool(tool("a"));
    expect(registry.listTools()).toHaveLength(1);
    expect(registry.getTool("missing")).toBeUndefined();
  });

  it("rejects duplicates", () => {
    const registry = new Registry();
    registry.registerTool(tool("a"));
    expect(() => registry.registerTool(tool("a"))).toThrow(/duplicate tool/);
  });
});
