import { afterEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../src/index.js";

describe("scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs jobs and records failures without dying", async () => {
    vi.useFakeTimers();
    const scheduler = new Scheduler();
    let runs = 0;
    scheduler.start({ name: "tick", intervalMs: 10, task: () => void (runs += 1) });
    scheduler.start({
      name: "boom",
      intervalMs: 10,
      task: () => {
        throw new Error("job failed");
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toBeGreaterThan(0);
    expect(scheduler.failures.length).toBeGreaterThanOrEqual(1);
    expect(scheduler.failures[0]?.job).toBe("boom");
    scheduler.stopAll();
    expect(scheduler.running).toHaveLength(0);
  });
});
