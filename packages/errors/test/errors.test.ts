import { describe, expect, it } from "vitest";
import { AppError, ExchangeRateLimitError, ValidationError, isAppError } from "../src/index.js";

describe("errors", () => {
  it("builds typed errors with safe metadata", () => {
    const err = ValidationError("bad pair", {
      correlationId: "c1",
      safeMetadata: { pair: "xx" },
    });
    expect(err.code).toBe("ValidationError");
    expect(err.retryable).toBe(false);
    expect(err.operationId).toMatch(/^op-/);
    expect(err.toJSON().correlationId).toBe("c1");
  });

  it("marks rate limit errors retryable", () => {
    expect(ExchangeRateLimitError("slow down").retryable).toBe(true);
  });

  it("narrows with isAppError", () => {
    expect(isAppError(ValidationError("x"))).toBe(true);
    expect(
      isAppError(new AppError({ code: "InternalError", message: "x", retryable: false })),
    ).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
  });
});
