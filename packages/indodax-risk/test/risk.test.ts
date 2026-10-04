import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  createRiskEngine,
  defaultRiskLimits,
  paperOnlyPolicy,
  type OrderFacts,
  type RiskContext,
} from "../src/index.js";

function order(notional: string): OrderFacts {
  return {
    notional: new Decimal(notional),
    quantity: new Decimal(1),
    price: new Decimal(notional),
    isMarket: false,
    symbol: "btc_idr",
  };
}

function context(): RiskContext {
  return {
    mode: "paper",
    capability: "PAPER",
    marketAgeMs: 5_000,
    accountAgeMs: 5_000,
    dailyPnl: new Decimal(0),
    tradeCount: 0,
    duplicate: false,
    reconciliationHalted: false,
    deadmanUnknown: false,
    balanceSufficient: true,
  };
}

describe("risk engine", () => {
  it("allows a fresh paper order", () => {
    const engine = createRiskEngine(defaultRiskLimits(), paperOnlyPolicy());
    const decision = engine.evaluate(order("100000"), context());
    expect(decision.outcome).toBe("ALLOW");
  });

  it("denies live mode under paper policy", () => {
    const engine = createRiskEngine(defaultRiskLimits(), paperOnlyPolicy());
    const decision = engine.evaluate(order("100000"), { ...context(), mode: "live" });
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasons).toContain("LIVE_MODE_DENIED");
  });

  it("denies oversized and undersized notionals", () => {
    const engine = createRiskEngine(defaultRiskLimits(), paperOnlyPolicy());
    expect(engine.evaluate(order("999999999"), context()).reasons).toContain("MAX_ORDER_SIZE");
    expect(engine.evaluate(order("1"), context()).reasons).toContain("MIN_ORDER_SIZE");
  });

  it("halts on kill switch", () => {
    const engine = createRiskEngine(defaultRiskLimits(), {
      ...paperOnlyPolicy(),
      killSwitch: true,
    });
    expect(engine.evaluate(order("100000"), context()).outcome).toBe("HALT");
  });

  it("denies overfull positions and rapid repeats", () => {
    const engine = createRiskEngine(defaultRiskLimits(), paperOnlyPolicy());
    const position = engine.evaluate(order("100000"), {
      ...context(),
      positionNotional: new Decimal("200000000"),
    });
    expect(position.outcome).toBe("DENY");
    expect(position.reasons).toContain("MAX_POSITION_EXPOSURE");
    const cooldown = engine.evaluate(order("100000"), { ...context(), lastOrderAtMs: Date.now() });
    expect(cooldown.outcome).toBe("DENY");
    expect(cooldown.reasons).toContain("COOLDOWN_ACTIVE");
    const stale = engine.evaluate(order("100000"), {
      ...context(),
      lastOrderAtMs: Date.now() - 60_000,
    });
    expect(stale.outcome).toBe("ALLOW");
  });

  it("fail-closes on unknown deadman for live", () => {
    const engine = createRiskEngine(defaultRiskLimits(), {
      ...paperOnlyPolicy(),
      allowedModes: ["live", "paper"],
      allowedCapabilities: ["READ", "PAPER", "TRADE"],
    });
    const decision = engine.evaluate(order("100000"), {
      ...context(),
      mode: "live",
      capability: "TRADE",
      deadmanUnknown: true,
    });
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasons).toContain("DEADMAN_UNKNOWN");
  });

  it("halts live trading on stale or expired deadman state", () => {
    const engine = createRiskEngine(defaultRiskLimits(), {
      ...paperOnlyPolicy(),
      allowedModes: ["live", "paper"],
      allowedCapabilities: ["READ", "PAPER", "TRADE"],
    });
    const base = {
      ...context(),
      mode: "live" as const,
      capability: "TRADE" as const,
      deadmanUnknown: false,
    };
    for (const state of ["STALE", "EXPIRED"] as const) {
      const decision = engine.evaluate(order("100000"), { ...base, deadmanState: state });
      expect(decision.outcome).toBe("DENY");
      expect(decision.reasons).toContain("DEADMAN_UNKNOWN");
    }
    const armed = engine.evaluate(order("100000"), { ...base, deadmanState: "ARMED" });
    expect(armed.outcome).toBe("ALLOW");
  });

  it("treats DISARMED as explicit opt-out, not unknown", () => {
    const engine = createRiskEngine(defaultRiskLimits(), {
      ...paperOnlyPolicy(),
      allowedModes: ["live", "paper"],
      allowedCapabilities: ["READ", "PAPER", "TRADE"],
    });
    const decision = engine.evaluate(order("100000"), {
      ...context(),
      mode: "live" as const,
      capability: "TRADE" as const,
      deadmanUnknown: false,
      deadmanState: "DISARMED",
    });
    expect(decision.outcome).toBe("ALLOW");
  });

  it("denies suspended markets and skips unknown suspension", () => {
    const engine = createRiskEngine(defaultRiskLimits(), paperOnlyPolicy());
    const halted = engine.evaluate(order("100000"), { ...context(), marketSuspended: true });
    expect(halted.outcome).toBe("DENY");
    expect(halted.reasons).toContain("MARKET_SUSPENDED");
    expect(engine.evaluate(order("100000"), context()).outcome).toBe("ALLOW");
    expect(engine.evaluate(order("100000"), { ...context(), marketSuspended: null }).outcome).toBe(
      "ALLOW",
    );
  });
});
