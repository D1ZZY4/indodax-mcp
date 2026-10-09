import { z } from "zod";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

const SYSTEM_READ = {
  capability: "SYSTEM" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

/** The two kinds the former indodax_audit_risk filtered for. */
const RISK_KINDS = ["RiskApproved", "RiskRejected"] as const;

/**
 * One audit read.
 *
 * Three tools answered three questions over the same in-memory trail:
 * recent entries, the trace for one correlation id, and the risk decision
 * feed. All three were `app.audit` with a different filter, so they are one
 * tool with the filters promoted to arguments. `correlationId` is what
 * `indodax_execution_trace` did, and `kinds: ["RiskApproved","RiskRejected"]`
 * is what `indodax_audit_risk` did.
 */
const audit = defineTool(
  {
    name: "indodax_audit",
    title: "Audit trail",
    description:
      "Read-only. The audit trail with filters. Absorbs the former indodax_audit_events, indodax_execution_trace, and indodax_audit_risk. Args: limit default 20 max 100; optional kind for one audit kind; optional kinds for several, where RiskApproved plus RiskRejected reproduces the old risk feed and also returns approved and rejected counts; optional correlationId to return every entry for one decision in order. Returns newest last. An empty trail is normal activity state, not a failure.",
    ...SYSTEM_READ,
  },
  {
    limit: z.number().int().min(1).max(100).optional(),
    kind: z.string().min(1).optional(),
    kinds: z.array(z.string().min(1)).min(1).optional(),
    correlationId: z.string().min(1).optional(),
  },
);

export function registerAuditTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(audit);

  handlers.tools.set("indodax_audit", async (raw) => {
    try {
      const args = parseArgs(audit.inputSchema, raw);
      const all = app.audit.list();
      let entries = all;
      if (args.kind !== undefined) {
        entries = entries.filter((entry) => entry.kind === args.kind);
      }
      if (args.kinds !== undefined) {
        const wanted = new Set(args.kinds);
        entries = entries.filter((entry) => wanted.has(entry.kind));
      }
      if (args.correlationId !== undefined) {
        entries = entries.filter((entry) => entry.correlationId === args.correlationId);
      }
      const recent = entries.slice(-(args.limit ?? 20));
      const present = [...new Set(recent.map((entry) => entry.kind))];
      const riskFeed = args.kinds?.some((kind) => (RISK_KINDS as readonly string[]).includes(kind));
      const warnings: string[] = [];
      if (recent.length === 0) {
        warnings.push(
          args.correlationId === undefined
            ? "audit trail is empty: no activity recorded yet in this session, not a failure"
            : `no audit entries for correlation id ${args.correlationId} in this session`,
        );
      }
      return ok(
        {
          total: all.length,
          filtered: entries.length,
          count: recent.length,
          correlationId: args.correlationId ?? null,
          kinds: present,
          entries: recent,
          // Present only for the risk feed, so an ordinary read does not carry
          // counts that would be zero by definition.
          ...(riskFeed === true
            ? {
                approved: recent.filter((entry) => entry.kind === "RiskApproved").length,
                rejected: recent.filter((entry) => entry.kind === "RiskRejected").length,
              }
            : {}),
          summary: `${recent.length} entr(ies) of ${all.length} total${args.kind !== undefined ? ` filtered by ${args.kind}` : ""}${args.kinds !== undefined ? ` filtered by ${args.kinds.join(",")}` : ""}${args.correlationId !== undefined ? ` for ${args.correlationId}` : ""}`,
        },
        warnings,
      );
    } catch (error) {
      return fail(error);
    }
  });
}
