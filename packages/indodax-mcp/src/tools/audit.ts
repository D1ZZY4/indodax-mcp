import { z } from "zod";
import type { Registry } from "@d1zzy4-jethools/mcp-registry";
import type { ServerHandlers } from "@d1zzy4-jethools/mcp-core";
import { fail, ok, parseArgs } from "@d1zzy4-jethools/mcp-app/respond";
import { defineTool } from "@d1zzy4-jethools/mcp-app/tools/define";
import type { AppServices } from "@d1zzy4-jethools/mcp-app/composition";

const READ = {
  capability: "SYSTEM" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

const auditEvents = defineTool(
  {
    name: "indodax_audit_events",
    title: "Audit events",
    description:
      "Read-only. Recent audit entries, newest last. Args: limit default 20 max 100, optional kind and correlationId filters.",
    ...READ,
  },
  {
    limit: z.number().int().min(1).max(100).optional(),
    kind: z.string().min(1).optional(),
    correlationId: z.string().min(1).optional(),
  },
);

const executionTrace = defineTool(
  {
    name: "indodax_execution_trace",
    title: "Execution trace",
    description:
      "Read-only. Every audit entry for one correlation id in order. Args: correlationId required.",
    ...READ,
  },
  { correlationId: z.string().min(1) },
);

export function registerAuditTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(auditEvents);
  registry.registerTool(executionTrace);

  handlers.tools.set("indodax_audit_events", async (raw) => {
    try {
      const args = parseArgs(auditEvents.inputSchema, raw);
      const total = app.audit.list().length;
      let entries = app.audit.list();
      if (args.kind !== undefined) entries = entries.filter((entry) => entry.kind === args.kind);
      if (args.correlationId !== undefined) {
        entries = entries.filter((entry) => entry.correlationId === args.correlationId);
      }
      const recent = entries.slice(-(args.limit ?? 20));
      const kinds = [...new Set(recent.map((entry) => entry.kind))];
      return ok(
        {
          count: recent.length,
          total,
          filtered: entries.length,
          kinds,
          entries: recent,
          summary: `${recent.length} entr(ies) of ${total} total${args.kind ? ` filtered by ${args.kind}` : ""}${args.correlationId ? ` for ${args.correlationId}` : ""}`,
        },
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
      const args = parseArgs(executionTrace.inputSchema, raw);
      const trace = app.audit.trace(args.correlationId);
      return ok(
        {
          correlationId: args.correlationId,
          count: trace.length,
          kinds: [...new Set(trace.map((entry) => entry.kind))],
          trace,
          summary:
            trace.length > 0
              ? `${trace.length} audit entr(ies) for ${args.correlationId}`
              : `no audit entries for ${args.correlationId} yet`,
        },
        trace.length === 0
          ? [`no audit entries for correlation id ${args.correlationId} in this session`]
          : [],
      );
    } catch (error) {
      return fail(error);
    }
  });
}
