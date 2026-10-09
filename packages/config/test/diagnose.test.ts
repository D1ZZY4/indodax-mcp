import { describe, expect, it } from "vitest";
import { diagnoseEnv, hasCredentials, loadConfig, loadEnv } from "@d1zzy4-jethools/config";

describe("configuration diagnosis", () => {
  it("reports both credentials as absent for an empty environment", () => {
    const diagnostic = diagnoseEnv({});
    expect(diagnostic.credentials).toEqual({
      INDODAX_API_KEY: "absent",
      INDODAX_API_SECRET: "absent",
    });
    expect(diagnostic.explicitSource).toBe(true);
  });

  it("reports process env as the origin when the caller supplies it", () => {
    const diagnostic = diagnoseEnv({
      INDODAX_API_KEY: "k",
      INDODAX_API_SECRET: "s",
      DATABASE_URL: "postgresql://localhost/indodax",
    });
    expect(diagnostic.credentials.INDODAX_API_KEY).toBe("process-env");
    expect(diagnostic.credentials.INDODAX_API_SECRET).toBe("process-env");
    expect(diagnostic.otherVariablesPresent).toContain("DATABASE_URL");
  });

  it("distinguishes one missing half of the credential pair", () => {
    const diagnostic = diagnoseEnv({ INDODAX_API_KEY: "k" });
    expect(diagnostic.credentials.INDODAX_API_KEY).toBe("process-env");
    expect(diagnostic.credentials.INDODAX_API_SECRET).toBe("absent");
  });

  it("treats an empty string as absent, matching the parser", () => {
    const diagnostic = diagnoseEnv({ INDODAX_API_KEY: "", INDODAX_API_SECRET: "" });
    expect(diagnostic.credentials.INDODAX_API_KEY).toBe("absent");
  });

  it("does not include any credential value in its output", () => {
    const diagnostic = diagnoseEnv({
      INDODAX_API_KEY: "super-secret-key",
      INDODAX_API_SECRET: "super-secret-value",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("super-secret");
  });

  it("agrees with hasCredentials about whether authenticated reads are possible", () => {
    const complete = { INDODAX_API_KEY: "k", INDODAX_API_SECRET: "s" };
    expect(hasCredentials(loadEnv(complete))).toBe(true);
    expect(diagnoseEnv(complete).credentials).toEqual({
      INDODAX_API_KEY: "process-env",
      INDODAX_API_SECRET: "process-env",
    });
    const half = loadEnv({ INDODAX_API_KEY: "k" });
    expect(hasCredentials(half)).toBe(false);
    expect(half.INDODAX_API_SECRET).toBeUndefined();
    expect(diagnoseEnv({ INDODAX_API_KEY: "k" }).credentials.INDODAX_API_SECRET).toBe("absent");
  });

  it("produces the environment and its diagnostic from one source", () => {
    const { env, diagnostic } = loadConfig({ INDODAX_API_KEY: "k", INDODAX_API_SECRET: "s" });
    expect(hasCredentials(env)).toBe(true);
    expect(diagnostic.credentials.INDODAX_API_KEY).toBe("process-env");
    // An explicit source must never claim the repository file was consulted.
    expect(diagnostic.repoEnvFileFound).toBe(false);
  });
});
