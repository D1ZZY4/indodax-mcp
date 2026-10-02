import { describe, expect, it } from "vitest";
import { ExecutionService, type ExecutionBackend, type ExecutionRequest } from "../src/index.js";
import type { RiskDecision } from "@indodax-mcp/core";

const allow: RiskDecision = { outcome: "ALLOW", reasons: [], message: "allowed" };
const deny: RiskDecision = { outcome: "DENY", reasons: ["KILL_SWITCH"], message: "stopped" };

const backend: ExecutionBackend = {
  name: "ok",
  submit: async (request: ExecutionRequest) => ({
    internalOrderId: request.order.internalOrderId,
    exchangeOrderId: null,
    accepted: true,
    message: "accepted",
    executedAt: new Date().toISOString(),
  }),
  cancel: async () => true,
};

describe("execution service", () => {
  it("rejects without risk approval", async () => {
    const service = new ExecutionService(backend);
    const request = {
      order: { internalOrderId: "o1" },
      mode: "paper",
      capability: "PAPER",
      correlationId: "c1",
      requestedAt: new Date().toISOString(),
    } as ExecutionRequest;
    await expect(service.execute(request, deny)).rejects.toThrow();
  });

  it("delegates approved requests to the backend", async () => {
    const service = new ExecutionService(backend);
    const request = {
      order: { internalOrderId: "o1" },
      mode: "paper",
      capability: "PAPER",
      correlationId: "c1",
      requestedAt: new Date().toISOString(),
    } as ExecutionRequest;
    const result = await service.execute(request, allow);
    expect(result.accepted).toBe(true);
    expect(service.backendName).toBe("ok");
  });
});
