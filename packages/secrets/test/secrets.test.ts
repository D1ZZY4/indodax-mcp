import { describe, expect, it } from "vitest";
import { SecretValue, redact, redactHeaders } from "../src/index.js";

describe("secrets", () => {
  it("never prints values", () => {
    const secret = new SecretValue("abc123");
    expect(secret.toString()).toBe("********");
    expect(secret.toJSON()).toBe("********");
    expect(secret.expose()).toBe("abc123");
    expect(secret.fingerprint()).toBe("****");
  });

  it("redacts sensitive text and headers", () => {
    expect(redact("api_secret=xyz")).toBe("[redacted api_secret content]");
    expect(redact("clean text")).toBe("clean text");
    expect(redactHeaders({ Sign: "abc", "Content-Type": "json" })).toEqual({
      Sign: "[redacted]",
      "Content-Type": "json",
    });
  });
});
