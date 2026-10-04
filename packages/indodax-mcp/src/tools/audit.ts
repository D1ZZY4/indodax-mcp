import { z } from "zod";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "../respond.js";
import type { AppServices } from "../composition.js";

const READ = {
  capability: "SYSTEM" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

export function registerAuditTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_audit_events",
      title: "Audit events",
      description:
        "Read-only. Recent audit entries, newest last. Args: limit default 20 max 100, optional kind and correlationId filters.",
      ...READ,
    },
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      kind: z.string().min(1).optional(),
      correlationId: z.string().min(1).optional(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_execution_trace",
      title: "Execution trace",
      description:
        "Read-only. Every audit entry for one correlation id in order. Args: correlationId required.",
      ...READ,
    },
    inputSchema: z.object({ correlationId: z.string().min(1) }),
  });

  handlers.tools.set("indodax_audit_events", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          limit: z.number().int().min(1).max(100).optional(),
          kind: z.string().min(1).optional(),
          correlationId: z.string().min(1).optional(),
        }),
        raw,
      );
      let entries = app.audit.list();
      if (args.kind !== undefined) entries = entries.filter((entry) => entry.kind === args.kind);
      if (args.correlationId !== undefined) {
        entries = entries.filter((entry) => entry.correlationId === args.correlationId);
      }
      const recent = entries.slice(-(args.limit ?? 20));
      return ok(
        recent,
        recent.length === 0
          ? ["audit trail is empty: no activity recorded yet in this session, not a failure"]
          : [],
      );
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_execution_trace", async (raw) => {
    try {
      const args = parseArgs(z.object({ correlationId: z.string().min(1) }), raw);
      const trace = app.audit.trace(args.correlationId);
      return ok(
        trace,
        trace.length === 0
          ? [`no audit entries for correlation id ${args.correlationId} in this session`]
          : [],
      );
    } catch (error) {
      return fail(error);
    }
  });
}
