import { describe, expect, it } from "vitest";
import { hasCredentials, loadEnv } from "../src/index.js";

describe("config", () => {
  it("loads empty env with safe defaults", () => {
    const env = loadEnv({});
    expect(env.APP_ENV).toBe("paper");
    expect(hasCredentials(env)).toBe(false);
  });

  it("detects complete credentials", () => {
    const env = loadEnv({ INDODAX_API_KEY: "k", INDODAX_API_SECRET: "s" });
    expect(hasCredentials(env)).toBe(true);
  });
});
