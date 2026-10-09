import type { z } from "zod";
import { AppError, ValidationError } from "@d1zzy4-jethools/errors";

export interface ToolSuccess {
  content: { type: "text"; text: string }[];
  isError?: false;
}

export interface ToolFailure {
  content: { type: "text"; text: string }[];
  isError: true;
}

export function ok(data: unknown, warnings: string[] = []): ToolSuccess {
  const body: Record<string, unknown> = {
    status: "ok",
    data,
    fetchedAt: new Date().toISOString(),
  };
  if (warnings.length > 0) body.warnings = warnings;
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}

export function fail(error: unknown): ToolFailure {
  // Only typed AppErrors carry their message to consumers. Anything else
  // becomes a generic failure so internal details never leak over MCP.
  const payload: Record<string, unknown> =
    error instanceof AppError
      ? { status: "error", ...error.toJSON() }
      : {
          status: "error",
          code: "InternalError",
          message: "unexpected internal failure",
          retryable: false,
        };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: true };
}

export function parseArgs<T>(schema: z.ZodType<T>, raw: Record<string, unknown>): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw ValidationError("invalid tool arguments", {
      safeMetadata: { issues: parsed.error.issues.slice(0, 3) },
    });
  }
  return parsed.data;
}
