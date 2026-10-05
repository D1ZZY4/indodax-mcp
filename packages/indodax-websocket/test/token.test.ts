import { describe, expect, it } from "vitest";
import { requestPrivateToken } from "@indodax-mcp/indodax-websocket/token";
import type { FetchFn } from "@indodax-mcp/transport";

function fetchOk(): FetchFn {
  return (async () =>
    new Response(
      JSON.stringify({ success: 1, return: { connToken: "tok-1", channel: "pws:#c" } }),
    )) as FetchFn;
}

describe("private token", () => {
  it("signs the documented body and returns token plus channel", async () => {
    let seenBody = "";
    let seenSign = "";
    const fetchFn = (async (_input: string, init?: RequestInit) => {
      seenBody = String(init?.body ?? "");
      const headers = init?.headers as Record<string, string> | undefined;
      seenSign = String(headers?.Sign ?? "");
      return new Response(
        JSON.stringify({ success: 1, return: { connToken: "tok-1", channel: "pws:#c" } }),
      );
    }) as FetchFn;
    const result = await requestPrivateToken("KEY123", "SECRET123", fetchFn);
    expect(result).toEqual({ token: "tok-1", channel: "pws:#c" });
    expect(seenBody).toBe("client=tapi&tapi_key=KEY123");
    expect(seenSign).toMatch(/^[0-9a-f]{128}$/);
  });

  it("rejects exchange failures without leaking the token", async () => {
    const denied = (async () =>
      new Response(JSON.stringify({ success: 0, error: "Invalid TAPI key" }))) as FetchFn;
    await expect(requestPrivateToken("K", "S", denied)).rejects.toThrow(/rejected/);
    await expect(requestPrivateToken("K", "S", fetchOk())).resolves.toEqual({
      token: "tok-1",
      channel: "pws:#c",
    });
  });
});
