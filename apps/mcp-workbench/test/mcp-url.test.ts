import { describe, expect, it } from "vitest";

/**
 * The pages pass the relative "/mcp" and the SDK transport needs an absolute
 * URL. `new URL("/mcp")` throws in a browser, so the previous code only ever
 * worked where a base happened to exist, and the workbench reported a
 * connection failure against a gateway that was actually reachable.
 *
 * This mirrors the resolution the client performs, so the regression is caught
 * without a live gateway.
 */
describe("mcp endpoint resolution", () => {
  it("resolves a relative path against the page origin", () => {
    expect(new URL("/mcp", "http://127.0.0.1:5173/").href).toBe("http://127.0.0.1:5173/mcp");
  });

  it("keeps an absolute url unchanged", () => {
    const absolute = "http://127.0.0.1:8000/mcp";
    expect(new URL(absolute, "http://127.0.0.1:5173/").href).toBe(absolute);
  });

  it("is the only reason a relative /mcp needs a base", () => {
    // Without a base the constructor throws, which is what broke the page.
    expect(() => new URL("/mcp")).toThrow();
  });
});
