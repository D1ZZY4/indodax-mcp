import { describe, expect, it } from "vitest";
import { DeadmanSwitch } from "../src/index.js";

describe("deadman switch", () => {
  it("arms, refreshes, and disarms", () => {
    const deadman = new DeadmanSwitch();
    expect(deadman.arm(["btc_idr"], 120_000).state).toBe("ARMED");
    expect(deadman.recordRefreshSuccess().consecutiveFailures).toBe(0);
    expect(deadman.disarm().state).toBe("DISARMED");
  });

  it("fail-closes after repeated refresh failures", () => {
    const deadman = new DeadmanSwitch();
    deadman.arm(["btc_idr"], 120_000);
    deadman.recordRefreshFailure();
    expect(deadman.shouldHaltLiveTrading()).toBe(true);
    deadman.recordRefreshFailure();
    deadman.recordRefreshFailure();
    expect(deadman.snapshot().state).toBe("EXPIRED");
  });

  it("rejects empty pairs and bad countdowns", () => {
    const deadman = new DeadmanSwitch();
    expect(() => deadman.arm([], 1000)).toThrow();
    expect(() => deadman.arm(["btc_idr"], 0)).toThrow();
  });
});
