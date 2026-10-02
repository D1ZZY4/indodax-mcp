import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Registry } from "@indodax-mcp/mcp-registry";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildServer } from "../src/index.js";

function setup() {
  const registry = new Registry();
  registry.registerTool({
    metadata: {
      name: "echo_ok",
      title: "Echo",
      description: "Returns its input for builder tests.",
      capability: "SYSTEM",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({ value: z.string().optional() }),
  });
  registry.registerResource({
    uri: "test://value",
    name: "test-value",
    title: "Value",
    description: "Static test resource.",
  });
  registry.registerPrompt({
    name: "test_prompt",
    title: "Prompt",
    description: "Static test prompt.",
    args: [],
  });
  const server = buildServer({
    name: "builder-test",
    version: "1.0.0",
    registry,
    handlers: {
      tools: new Map([
        [
          "echo_ok",
          (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(args) }] }),
        ],
      ]),
      resources: new Map([["test://value", () => "hello"]]),
      prompts: new Map([["test_prompt", () => [{ role: "user" as const, text: "hi" }]]]),
    },
  });
  return server;
}

describe("mcp-core builder", () => {
  it("wires tools, resources, and prompts", async () => {
    const harness = await withInMemoryServer(setup());
    try {
      const tools = await harness.client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("echo_ok");
      const resources = await harness.client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("test://value");
      const prompts = await harness.client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toContain("test_prompt");
      const called = await harness.client.callTool({ name: "echo_ok", arguments: { value: "v" } });
      expect(called.isError).not.toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("converts thrown errors into error payloads", async () => {
    const registry = new Registry();
    registry.registerTool({
      metadata: {
        name: "boom",
        title: "Boom",
        description: "Always throws for builder tests.",
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
    const server = buildServer({
      name: "builder-test",
      version: "1.0.0",
      registry,
      handlers: {
        tools: new Map([
          [
            "boom",
            () => {
              throw new Error("kaboom");
            },
          ],
        ]),
        resources: new Map(),
        prompts: new Map(),
      },
    });
    const harness = await withInMemoryServer(server);
    try {
      const result = await harness.client.callTool({ name: "boom", arguments: {} });
      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("refuses to build with missing handlers", () => {
    const registry = new Registry();
    registry.registerTool({
      metadata: {
        name: "ghost",
        title: "Ghost",
        description: "Has no handler registered here.",
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
    expect(() =>
      buildServer({
        name: "builder-test",
        version: "1.0.0",
        registry,
        handlers: { tools: new Map(), resources: new Map(), prompts: new Map() },
      }),
    ).toThrow(/missing handler/);
  });
});
