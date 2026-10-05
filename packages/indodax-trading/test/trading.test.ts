import { describe, expect, it } from "vitest";
import { createRiskEngine, defaultRiskLimits, paperOnlyPolicy } from "@indodax-mcp/indodax-risk";
import { TradingService, type TradeIntent } from "@indodax-mcp/indodax-trading";

function intent(): TradeIntent {
  return {
    agentId: "a",
    sessionId: "s",
    symbol: { base: "btc", quote: "idr" },
    side: "BUY",
    orderType: "LIMIT",
    price: "1000",
    quantityOrIdr: "100",
    quantityIsIdr: false,
    mode: "paper",
    capability: "PAPER",
    reason: "test",
  };
}

describe("trading service", () => {
  it("runs propose to order to review with risk approval", () => {
    const records: { kind: string }[] = [];
    const service = new TradingService(createRiskEngine(defaultRiskLimits(), paperOnlyPolicy()), {
      record: (entry) => records.push(entry),
    });
    const proposal = service.propose(intent());
    const order = service.toOrder(proposal, { tenantId: "t", exchangeAccountId: "a" });
    expect(order.state).toBe("NEW");
    const decision = service.review(order, {
      mode: "paper",
      capability: "PAPER",
      marketAgeMs: 1_000,
      accountAgeMs: 1_000,
      dailyPnl: null,
      tradeCount: 0,
      duplicate: false,
      reconciliationHalted: false,
      deadmanUnknown: false,
      balanceSufficient: true,
    });
    expect(decision.outcome).toBe("ALLOW");
    expect(order.state).toBe("ACCEPTED");
    expect(records.map((record) => record.kind)).toEqual(["AgentIntentCreated", "RiskApproved"]);
  });

  it("rejects invalid amounts", () => {
    const records: { kind: string }[] = [];
    const service = new TradingService(createRiskEngine(defaultRiskLimits(), paperOnlyPolicy()), {
      record: (entry) => records.push(entry),
    });
    expect(() => service.propose({ ...intent(), quantityOrIdr: "0" })).toThrow();
  });

  it("binds timeInForce to order type (GTC/MOC LIMIT-only, FOK MARKET-only)", () => {
    const service = new TradingService(createRiskEngine(defaultRiskLimits(), paperOnlyPolicy()), {
      record: () => {},
    });
    const market = {
      ...intent(),
      side: "SELL" as const,
      orderType: "MARKET" as const,
      price: null,
    };
    const fok = service.propose(market);
    expect(() =>
      service.toOrder(
        { ...fok, intent: { ...fok.intent, timeInForce: "FOK" } },
        {
          tenantId: "t",
          exchangeAccountId: "a",
        },
      ),
    ).not.toThrow();
    const limit = service.propose(intent());
    expect(() =>
      service.toOrder(
        { ...limit, intent: { ...limit.intent, timeInForce: "FOK" } },
        {
          tenantId: "t",
          exchangeAccountId: "a",
        },
      ),
    ).toThrow(/FOK/);
    expect(() =>
      service.toOrder(
        { ...fok, intent: { ...fok.intent, timeInForce: "GTC" } },
        {
          tenantId: "t",
          exchangeAccountId: "a",
        },
      ),
    ).toThrow(/LIMIT/);
  });

  it("issues unique correlation ids across service instances", () => {
    const make = () =>
      new TradingService(createRiskEngine(defaultRiskLimits(), paperOnlyPolicy()), {
        record: () => {},
      });
    const first = make().propose(intent()).correlationId;
    const second = make().propose(intent()).correlationId;
    expect(first).not.toBe(second);
    expect(`draft-${first}`).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
  });
});
