import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const serverSchema = {
  INDODAX_API_KEY: z.string().min(1).optional(),
  INDODAX_API_SECRET: z.string().min(1).optional(),
  INDODAX_RATE_LIMIT: z.coerce.number().int().positive().optional(),
  INDODAX_WS_TOKEN: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  MCP_PORT: z.coerce.number().int().positive().optional(),
  MCP_HOST: z.string().min(1).optional(),
  APP_ENV: z.enum(["development", "paper", "live"]).default("paper"),
  TRADE_ENABLED: z.stringbool().optional(),
  // Parsed for compatibility only. Withdrawal stays denied in application
  // code regardless of this flag, so setting it true never enables it.
  WITHDRAW_ENABLED: z.stringbool().optional(),
  STOP_AUTOPOLL_MS: z.coerce.number().int().positive().optional(),
  ALERT_AUTOPOLL_MS: z.coerce.number().int().positive().optional(),
};

export interface AppEnv {
  INDODAX_API_KEY?: string | undefined;
  INDODAX_API_SECRET?: string | undefined;
  INDODAX_RATE_LIMIT?: number | undefined;
  INDODAX_WS_TOKEN?: string | undefined;
  DATABASE_URL?: string | undefined;
  MCP_PORT?: number | undefined;
  MCP_HOST?: string | undefined;
  APP_ENV: "development" | "paper" | "live";
  TRADE_ENABLED?: boolean | undefined;
  WITHDRAW_ENABLED?: boolean | undefined;
  STOP_AUTOPOLL_MS?: number | undefined;
  ALERT_AUTOPOLL_MS?: number | undefined;
}

/** Which configuration channel supplied a value. Reported as a name, never a value. */
export type ConfigSource = "process-env" | "repo-env-file" | "absent";

export interface ConfigDiagnostic {
  /** True when the caller passed its own source (tests) instead of process.env. */
  explicitSource: boolean;
  /** True when a repository .env file was found and merged. */
  repoEnvFileFound: boolean;
  /** Per-variable origin for the exchange credential contract. */
  credentials: Record<"INDODAX_API_KEY" | "INDODAX_API_SECRET", ConfigSource>;
  /** Names of other server variables the process actually received. */
  otherVariablesPresent: string[];
}

export interface LoadedConfig {
  env: AppEnv;
  diagnostic: ConfigDiagnostic;
}

/**
 * Explain where configuration came from.
 *
 * The most common support failure is an operator exporting credentials for an
 * MCP entry that never received them, for example a harness entry that starts
 * the server as a separate process. `indodax_config_status` then reports
 * "credentials absent" with no clue why. This records the origin per variable
 * so that gap is visible from the tool output itself.
 *
 * Values are never included: only presence and origin. The diagnostic is
 * computed from the same source that produced `env`, so the two can never
 * describe different environments.
 */
function diagnoseSource(
  source: Record<string, string | undefined>,
  fileValues: Record<string, string>,
  explicitSource: boolean,
): ConfigDiagnostic {
  const resolve = (key: string): ConfigSource => {
    const fromProcess = source[key];
    if (fromProcess !== undefined && fromProcess !== "") return "process-env";
    if (fileValues[key] !== undefined && fileValues[key] !== "") return "repo-env-file";
    return "absent";
  };
  return {
    explicitSource,
    repoEnvFileFound: !explicitSource && Object.keys(fileValues).length > 0,
    credentials: {
      INDODAX_API_KEY: resolve("INDODAX_API_KEY"),
      INDODAX_API_SECRET: resolve("INDODAX_API_SECRET"),
    },
    otherVariablesPresent: [
      "DATABASE_URL",
      "MCP_PORT",
      "MCP_HOST",
      "APP_ENV",
      "TRADE_ENABLED",
      "WITHDRAW_ENABLED",
      "STOP_AUTOPOLL_MS",
      "ALERT_AUTOPOLL_MS",
      "INDODAX_RATE_LIMIT",
      "INDODAX_WS_TOKEN",
    ].filter((key) => source[key] !== undefined && source[key] !== ""),
  };
}

/**
 * Load configuration together with the provenance of every credential.
 *
 * Prefer this over `loadEnv` in an entrypoint so the diagnostic and the parsed
 * environment are guaranteed to describe the same input.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): LoadedConfig {
  // Explicit test sources stay exactly as given. Only the default path
  // (real process env) falls back to the repository .env, so any
  // entrypoint finds the same config regardless of its working directory.
  const explicitSource = source !== process.env;
  const fileValues = explicitSource ? {} : loadRepoEnvFile();
  const env = createEnv({
    server: serverSchema,
    runtimeEnv: { ...fileValues, ...source },
    emptyStringAsUndefined: true,
  });
  return { env, diagnostic: diagnoseSource(source, fileValues, explicitSource) };
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  return loadConfig(source).env;
}

/** Standalone diagnosis of an arbitrary source. Used by tests and tooling. */
export function diagnoseEnv(
  source: Record<string, string | undefined> = process.env,
): ConfigDiagnostic {
  const explicitSource = source !== process.env;
  const fileValues = explicitSource ? {} : loadRepoEnvFile();
  return diagnoseSource(source, fileValues, explicitSource);
}

/**
 * Minimal dotenv parser for the repository .env. Real process env always
 * wins; the file only fills keys that are otherwise unset. Returns {} when
 * no repository .env is found above this package.
 */
export function loadRepoEnvFile(from = fileURLToPath(import.meta.url)): Record<string, string> {
  let dir = dirname(from);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return parseDotenv(readFileSync(candidate, "utf8"));
    const parent = dirname(dir);
    if (parent === dir) return {};
    dir = parent;
  }
  return {};
}

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (key !== "") out[key] = value;
  }
  return out;
}

export function hasCredentials(env: AppEnv): boolean {
  return Boolean(env.INDODAX_API_KEY && env.INDODAX_API_SECRET);
}
