import { beforeEach, describe, expect, it } from "vitest";
import {
  describeEgress,
  egressAddresses,
  egressHint,
  resetEgressCache,
} from "@d1zzy4-jethools/transport/egress";

function stubFetch(v4: string | null, v6: string | null) {
  return (async (input: string) => {
    const body = input.includes("api6") ? v6 : v4;
    if (body === null) throw new Error("network down");
    return new Response(body);
  }) as (input: string, init?: RequestInit) => Promise<Response>;
}

beforeEach(() => {
  resetEgressCache();
});

describe("egressAddresses", () => {
  it("resolves both families through the injected fetch", async () => {
    const result = await egressAddresses(stubFetch("203.0.113.7", "2001:db8::9"));
    expect(result).toEqual({ ipv4: "203.0.113.7", ipv6: "2001:db8::9", fresh: true });
  });

  it("keeps a partial answer instead of failing the rejection", async () => {
    const result = await egressAddresses(stubFetch("203.0.113.7", null));
    expect(result.ipv4).toBe("203.0.113.7");
    expect(result.ipv6).toBeNull();
  });

  it("returns nulls without throwing when the lookup fails", async () => {
    const result = await egressAddresses(stubFetch(null, null));
    expect(result).toEqual({ ipv4: null, ipv6: null, fresh: true });
  });

  it("serves the cached answer without another lookup", async () => {
    let calls = 0;
    const counting = (async (input: string, init?: RequestInit) => {
      calls += 1;
      return stubFetch("1.1.1.1", "2001:db8::1")(input, init);
    }) as (input: string, init?: RequestInit) => Promise<Response>;
    await egressAddresses(counting);
    const second = await egressAddresses(counting);
    expect(second.fresh).toBe(false);
    expect(calls).toBe(2);
  });

  it("rejects a non-address response body", async () => {
    const result = await egressAddresses(stubFetch("not-an-ip", "also-not-an-ip"));
    expect(result.ipv4).toBeNull();
    expect(result.ipv6).toBeNull();
  });
});

describe("describeEgress", () => {
  it("names both families in one line", () => {
    expect(describeEgress({ ipv4: "203.0.113.7", ipv6: "2001:db8::9", fresh: true })).toContain(
      "IPv4 203.0.113.7",
    );
  });

  it("says plainly when nothing resolved", () => {
    expect(describeEgress({ ipv4: null, ipv6: null, fresh: true })).toContain(
      "could not be resolved",
    );
  });
});

describe("egressHint", () => {
  it("carries a null note and no CIDR when nothing resolved", async () => {
    const hint = await egressHint(stubFetch(null, null));
    expect(hint).toEqual({ note: null, ipv4: null, ipv6: null, cidrV4: null, cidrV6: null });
  });

  it("reports single-host CIDR blocks an exchange allowlist accepts", async () => {
    const hint = await egressHint(stubFetch("203.0.113.7", "2001:db8::9"));
    expect(hint.cidrV4).toBe("203.0.113.7/32");
    expect(hint.cidrV6).toBe("2001:db8::9/128");
    // The CIDR is named in the message, not only in the metadata.
    expect(hint.note).toContain("203.0.113.7/32");
    expect(hint.note).toContain("2001:db8::9/128");
  });
});
