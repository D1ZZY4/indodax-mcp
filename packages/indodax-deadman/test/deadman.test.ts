import { describe, expect, it } from "vitest";
import { DeadmanSwitch } from "@indodax-mcp/indodax-deadman";

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

  it("restores persisted protection state across restarts", () => {
    const armed = new DeadmanSwitch();
    armed.arm(["btc_idr"], 120_000);
    const fresh = new DeadmanSwitch();
    expect(fresh.snapshot().state).toBe("DISARMED");
    const restored = fresh.restore({ state: "ARMED", pairs: ["btc_idr"], countdownMs: 120_000 });
    expect(restored.state).toBe("ARMED");
    expect(restored.pairs).toEqual(["btc_idr"]);
    const stale = new DeadmanSwitch().restore({
      state: "STALE",
      pairs: ["btc_idr"],
      countdownMs: 120_000,
    });
    expect(stale.state).toBe("STALE");
    expect(
      new DeadmanSwitch().restore({ state: "DISARMED", pairs: [], countdownMs: null }).state,
    ).toBe("DISARMED");
    expect(() =>
      new DeadmanSwitch().restore({ state: "ARMED", pairs: [], countdownMs: null }),
    ).toThrow();
  });
});
