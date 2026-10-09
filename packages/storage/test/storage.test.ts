import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@indodax-mcp/storage";

describe("storage", () => {
  it("round-trips records", async () => {
    const repo = new MemoryRepository<{ v: number }>();
    expect(await repo.load("a")).toBeNull();
    await repo.save("a", { v: 1 });
    expect(await repo.load("a")).toEqual({ v: 1 });
    expect(await repo.list()).toHaveLength(1);
    expect(await repo.remove("a")).toBe(true);
    expect(await repo.remove("a")).toBe(false);
  });
});
