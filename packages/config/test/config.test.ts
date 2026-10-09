import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasCredentials, loadEnv, loadRepoEnvFile } from "@indodax-mcp/config";

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

  it("parses explicit false without enabling trading", () => {
    const env = loadEnv({ TRADE_ENABLED: "false", WITHDRAW_ENABLED: "false" });
    expect(env.TRADE_ENABLED).toBe(false);
    expect(env.WITHDRAW_ENABLED).toBe(false);
  });

  it("parses explicit true", () => {
    const env = loadEnv({ TRADE_ENABLED: "true", WITHDRAW_ENABLED: "1" });
    expect(env.TRADE_ENABLED).toBe(true);
    expect(env.WITHDRAW_ENABLED).toBe(true);
  });

  it("never pollutes an explicit source with the repo .env file", () => {
    const env = loadEnv({ APP_ENV: "paper" });
    expect(env.TRADE_ENABLED).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("parses the HTTP bind address with a safe loopback default", () => {
    expect(loadEnv({}).MCP_HOST).toBeUndefined();
    expect(loadEnv({ MCP_HOST: "0.0.0.0" }).MCP_HOST).toBe("0.0.0.0");
  });

  it("finds and parses a .env file above the caller", () => {
    const root = mkdtempSync(join(tmpdir(), "cfg-test-"));
    mkdirSync(join(root, "packages", "config", "src"), { recursive: true });
    writeFileSync(
      join(root, ".env"),
      '# comment\nAPP_ENV=live\nTRADE_ENABLED=true\nQUOTED="a b"\n',
    );
    const parsed = loadRepoEnvFile(join(root, "packages", "config", "src", "index.ts"));
    expect(parsed.APP_ENV).toBe("live");
    expect(parsed.TRADE_ENABLED).toBe("true");
    expect(parsed.QUOTED).toBe("a b");
    expect(loadRepoEnvFile(join(mkdtempSync(join(tmpdir(), "cfg-empty-")), "a", "b.ts"))).toEqual(
      {},
    );
  });
});
