import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AppError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";

export interface ToolContext {
  signal?: AbortSignal;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<unknown> | unknown;

export type ResourceHandler = (uri: string) => Promise<string> | string;

export interface PromptMessage {
  role: "user" | "assistant";
  text: string;
}

export type PromptHandler = (
  args: Record<string, string>,
) => PromptMessage[] | Promise<PromptMessage[]>;

export interface ServerHandlers {
  tools: Map<string, ToolHandler>;
  resources: Map<string, ResourceHandler>;
  prompts: Map<string, PromptHandler>;
}

export interface BuildServerOptions {
  name: string;
  version: string;
  registry: Registry;
  handlers: ServerHandlers;
}

function toTextPayload(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function toErrorPayload(error: unknown): { text: string; isError: true } {
  if (error instanceof AppError) {
    return { text: JSON.stringify(error.toJSON(), null, 2), isError: true };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { text: JSON.stringify({ code: "InternalError", message }, null, 2), isError: true };
}

export function buildServer(options: BuildServerOptions): McpServer {
  const server = new McpServer({ name: options.name, version: options.version });

  for (const entry of options.registry.listTools()) {
    const handler = options.handlers.tools.get(entry.metadata.name);
    if (!handler) throw new Error(`missing handler for tool ${entry.metadata.name}`);
    const inputSchema = entry.inputSchema as z.ZodType<Record<string, unknown>>;
    server.registerTool(
      entry.metadata.name,
      { description: entry.metadata.description, inputSchema },
      async (args) => {
        try {
          const result = await handler(args as Record<string, unknown>, {});
          return { content: [{ type: "text" as const, text: toTextPayload(result) }] };
        } catch (error) {
          const failure = toErrorPayload(error);
          return { content: [{ type: "text" as const, text: failure.text }], isError: true };
        }
      },
    );
  }

  for (const entry of options.registry.listResources()) {
    const handler = options.handlers.resources.get(entry.metadata.uri);
    if (!handler) throw new Error(`missing handler for resource ${entry.metadata.uri}`);
    server.registerResource(
      entry.metadata.name,
      entry.metadata.uri,
      { description: entry.metadata.description },
      async (uri) => {
        const text = await handler(uri.toString());
        return { contents: [{ uri: uri.toString(), text }] };
      },
    );
  }

  for (const entry of options.registry.listPrompts()) {
    const handler = options.handlers.prompts.get(entry.metadata.name);
    if (!handler) throw new Error(`missing handler for prompt ${entry.metadata.name}`);
    const shape: Record<string, z.ZodType<string>> = {};
    for (const arg of entry.metadata.args) {
      shape[arg.name] = arg.required ? z.string().min(1) : z.string().optional().default("");
    }
    server.registerPrompt(
      entry.metadata.name,
      { description: entry.metadata.description, argsSchema: z.object(shape) },
      async (args) => {
        const stringArgs: Record<string, string> = {};
        for (const [key, value] of Object.entries(args ?? {})) {
          if (typeof value === "string") stringArgs[key] = value;
        }
        const messages = await handler(stringArgs);
        return {
          messages: messages.map((message) => ({
            role: message.role,
            content: { type: "text" as const, text: message.text },
          })),
        };
      },
    );
  }

  return server;
}
