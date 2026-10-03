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
  TRADE_ENABLED: z.coerce.boolean().optional(),
  WITHDRAW_ENABLED: z.coerce.boolean().optional(),
  STOP_AUTOPOLL_MS: z.coerce.number().int().positive().optional(),
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
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  return createEnv({
    server: serverSchema,
    runtimeEnv: source,
    emptyStringAsUndefined: true,
  });
}

export function hasCredentials(env: AppEnv): boolean {
  return Boolean(env.INDODAX_API_KEY && env.INDODAX_API_SECRET);
}
