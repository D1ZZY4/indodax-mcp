import { z } from "zod";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "../respond.js";
import type { AppServices } from "../composition.js";

export function registerDeadmanTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_arm",
      title: "Arm Deadman",
      description:
        "Mutating safety state. Arm the Deadman countdown for pairs. Paper only simulates. Args: pairs, countdownMs.",
      capability: "TRADE",
      riskClass: "mutation",
      environmentRequirement: "paper",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({
      pairs: z.array(z.string().min(1)).min(1),
      countdownMs: z.number().positive(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_status",
      title: "Deadman status",
      description: "Read-only. Deadman state, pairs, and failure count.",
      capability: "READ",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_disarm",
      title: "Disarm Deadman",
      description: "Mutating safety state. Disarm the Deadman countdown.",
      capability: "TRADE",
      riskClass: "mutation",
      environmentRequirement: "paper",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({}),
  });

  handlers.tools.set("indodax_deadman_arm", async (raw) => {
    try {
      const args = parseArgs(
        z.object({ pairs: z.array(z.string().min(1)).min(1), countdownMs: z.number().positive() }),
        raw,
      );
      const status = app.deadman.arm(args.pairs, args.countdownMs);
      app.health.set("deadman", { status: "healthy", detail: `armed ${status.pairs.join(",")}` });
      return ok(status);
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deadman_status", async () => ok(app.deadman.snapshot()));
  handlers.tools.set("indodax_deadman_disarm", async () => {
    const status = app.deadman.disarm();
    app.health.set("deadman", { status: "healthy", detail: "disarmed" });
    return ok(status);
  });
}
