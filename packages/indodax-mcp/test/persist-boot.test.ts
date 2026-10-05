import { describe, expect, it } from "vitest";
import { resolveBootSnapshot } from "@indodax-mcp/indodax-mcp/persist-error";

describe("boot snapshot resolution", () => {
  it("restores stored state on a clean boot", () => {
    expect(resolveBootSnapshot(true, false)).toBe("restore");
  });

  it("keeps local mutations over the stored snapshot", () => {
    expect(resolveBootSnapshot(true, true)).toBe("keep-local");
  });

  it("starts fresh without stored state either way", () => {
    expect(resolveBootSnapshot(false, false)).toBe("fresh");
    expect(resolveBootSnapshot(false, true)).toBe("fresh");
  });
});
