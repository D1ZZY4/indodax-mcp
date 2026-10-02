import { z } from "zod";
import { Registry } from "@indodax-mcp/mcp-registry";
import { buildServer } from "@indodax-mcp/mcp-core";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";

export const APP_NAME = "indodax-mcp";
export const APP_VERSION = "1.0.0";

export function createRegistry(): Registry {
  const registry = new Registry();
  registry.registerTool({
    metadata: {
      name: "system_health",
      title: "System health",
      description:
        "Read-only service health with status and checks. Takes no arguments. Use to verify the server is alive.",
      capability: "SYSTEM",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({}),
  });
  registry.registerResource({
    uri: "system://health",
    name: "system-health",
    title: "System health",
    description: "Current health snapshot without secrets.",
  });
  registry.registerPrompt({
    name: "review_status",
    title: "Review status",
    description: "Guide the agent through a basic status review.",
    args: [],
  });
  return registry;
}

export function createHandlers(): ServerHandlers {
  return {
    tools: new Map([
      ["system_health", () => ({ status: "healthy", checks: ["startup complete"], mode: "paper" })],
    ]),
    resources: new Map([
      [
        "system://health",
        () => JSON.stringify({ status: "healthy", checks: ["startup complete"] }),
      ],
    ]),
    prompts: new Map([
      [
        "review_status",
        () => [{ role: "user" as const, text: "Call system_health and summarize service status." }],
      ],
    ]),
  };
}

export function buildAppServer() {
  return buildServer({
    name: APP_NAME,
    version: APP_VERSION,
    registry: createRegistry(),
    handlers: createHandlers(),
  });
}
