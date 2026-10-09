import { describe, expect, it } from "vitest";
import {
  LegacyTapiSigner,
  TapiV2Signer,
  canonicalizeParams,
  hmacSha256Hex,
  nextNonce,
  resetNonceForTests,
} from "@d1zzy4-jethools/indodax-auth";

describe("indodax-auth", () => {
  it("matches the HMAC-SHA256 reference vector", () => {
    expect(hmacSha256Hex("The quick brown fox jumps over the lazy dog", "key")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });

  it("keeps v1 and v2 signatures separate", () => {
    const v2 = new TapiV2Signer("k", "s").signQuery("a=b");
    const v1 = new LegacyTapiSigner("k", "s").signBody("a=b");
    expect(v2).toHaveLength(64);
    expect(v1).toHaveLength(128);
    expect(v2).not.toBe(v1);
  });

  it("canonicalizes params in sorted order", () => {
    expect(canonicalizeParams({ b: "2", a: "1" })).toBe("a=1&b=2");
  });

  it("issues monotonic nonces across clock stalls", () => {
    resetNonceForTests();
    const first = nextNonce(1000);
    const second = nextNonce(1000);
    const third = nextNonce(999);
    expect(second).toBe(first + 1);
    expect(third).toBe(second + 1);
  });
});
