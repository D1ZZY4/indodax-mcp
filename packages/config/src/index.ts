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
  APP_ENV: z.enum(["development", "paper", "live"]).default("paper"),
  TRADE_ENABLED: z.stringbool().optional(),
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
  APP_ENV: "development" | "paper" | "live";
  TRADE_ENABLED?: boolean | undefined;
  WITHDRAW_ENABLED?: boolean | undefined;
  STOP_AUTOPOLL_MS?: number | undefined;
  ALERT_AUTOPOLL_MS?: number | undefined;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  // Explicit test sources stay exactly as given. Only the default path
  // (real process env) falls back to the repository .env, so any
  // entrypoint finds the same config regardless of its working directory.
  const runtimeEnv = source === process.env ? { ...loadRepoEnvFile(), ...source } : source;
  return createEnv({
    server: serverSchema,
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
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
