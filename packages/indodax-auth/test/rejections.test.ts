import { describe, expect, it } from "vitest";
import { ExchangeApiError } from "@indodax-mcp/errors";
import {
  formatRejection,
  guidanceFor,
  outcomeFor,
  parseExchangePayload,
  translateExchangeError,
  translateReadError,
} from "@indodax-mcp/indodax-auth/rejections";

function httpError(status: number, body: unknown) {
  return ExchangeApiError(`unexpected HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`, {
    safeMetadata: { status, body: JSON.stringify(body) },
  });
}

const stubEgress = async () => ({ note: "IPv4 1.2.3.4", ipv4: "1.2.3.4", ipv6: null });

describe("outcomeFor", () => {
  it("names every verified code", () => {
    expect(outcomeFor(-2010)?.reason).toBe("insufficient_balance");
    expect(outcomeFor(-2015)?.reason).toBe("ip_not_allowlisted");
    expect(outcomeFor(-2011)?.reason).toBe("order_not_found");
    expect(outcomeFor(-2012)?.reason).toBe("order_already_completed");
  });

  it("returns undefined for unknown and null codes", () => {
    expect(outcomeFor(-9999)).toBeUndefined();
    expect(outcomeFor(null)).toBeUndefined();
  });

  it("exposes the guidance without the message", () => {
    expect(guidanceFor(-2010)).toContain("indodax_balances");
    expect(guidanceFor(-9999)).toBe("");
  });
});

describe("parseExchangePayload", () => {
  it("recovers the code from error metadata", () => {
    expect(parseExchangePayload(httpError(403, { code: -2015, msg: "nope" }))).toEqual({
      code: -2015,
      msg: "nope",
    });
  });

  it("returns null for non-app errors and empty bodies", () => {
    expect(parseExchangePayload(new Error("boom"))).toBeNull();
    expect(parseExchangePayload(ExchangeApiError("x", { safeMetadata: { body: "" } }))).toBeNull();
    expect(
      parseExchangePayload(ExchangeApiError("x", { safeMetadata: { body: "not json" } })),
    ).toBeNull();
  });
});

describe("formatRejection", () => {
  it("omits the egress note when the lookup resolved nothing", () => {
    const { message } = formatRejection("order", { code: -2015, msg: "Denied" }, null);
    expect(message).toContain("-2015");
    expect(message).not.toContain("undefined");
  });

  it("keeps the insufficient-balance fallback without a code", () => {
    const { message } = formatRejection("order", { msg: "Insufficient balance" }, null);
    expect(message).toContain("insufficient balance");
  });
});

describe("translateExchangeError", () => {
  it("attaches the resolved egress address to an IP rejection", async () => {
    const translated = await translateExchangeError(
      httpError(403, { code: -2015, msg: "Unauthorized IP address." }),
      "order",
      stubEgress,
    );
    expect(translated?.code).toBe(-2015);
    expect(translated?.message).toContain("1.2.3.4");
    expect(translated?.safeMetadata).toMatchObject({
      exchangeCode: -2015,
      reason: "ip_not_allowlisted",
      egressIpv4: "1.2.3.4",
    });
  });

  it("translates without a resolver when none is given", async () => {
    const translated = await translateExchangeError(
      httpError(400, { code: -2010, msg: "Insufficient balance" }),
      "order",
    );
    expect(translated?.message).toContain("indodax_balances");
  });

  it("returns null for failures with nothing translatable", async () => {
    expect(await translateExchangeError(new Error("boom"), "order", stubEgress)).toBeNull();
    expect(
      await translateExchangeError(
        ExchangeApiError("x", { safeMetadata: { body: "not json" } }),
        "order",
        stubEgress,
      ),
    ).toBeNull();
  });
});

describe("translateReadError", () => {
  it("preserves the read error code while enriching the message", async () => {
    const translated = await translateReadError(
      httpError(403, { code: -2015, msg: "Unauthorized IP address." }),
      "GET /api/v2/account",
      stubEgress,
    );
    expect(translated?.code).toBe("ExchangeApiError");
    expect(translated?.message).toContain("GET /api/v2/account");
    expect(translated?.message).toContain("1.2.3.4");
    expect(translated?.retryable).toBe(false);
  });

  it("keeps the original correlation id", async () => {
    const original = httpError(400, { code: -2010, msg: "Insufficient balance" });
    const withId = ExchangeApiError(original.message, {
      correlationId: "corr-9",
      safeMetadata: { status: 400, body: JSON.stringify({ code: -2010 }) },
    });
    const translated = await translateReadError(withId, "GET /api/v2/account");
    expect(translated?.correlationId).toBe("corr-9");
  });

  it("returns null when there is nothing translatable", async () => {
    expect(await translateReadError(new Error("boom"), "GET /x")).toBeNull();
  });
});
