import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AppError } from "@indodax-mcp/errors";
import type { ToolMetadata } from "@indodax-mcp/mcp-contracts";
import type { Registry } from "@indodax-mcp/mcp-registry";

export interface ToolContext {
  // Intentionally empty: SDK 2.2.0 exposes no per-call abort signal to
  // tool callbacks (cancellation only tears down the transport), so no
  // fake signal is provided here.
  signal?: never;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult> | ToolResult;

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

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
  /**
   * Optional central policy gate. Runs before every tool handler.
   * Throw to deny. Capability, risk, and audit-class enforcement stay
   * with handlers and the risk engine; this gate covers only the
   * mechanical metadata dimensions (auth, environment).
   */
  guard?: (metadata: ToolMetadata, args: Record<string, unknown>) => void | Promise<void>;
}

function toErrorPayload(error: unknown): { text: string; isError: true } {
  if (error instanceof AppError) {
    return { text: JSON.stringify(error.toJSON(), null, 2), isError: true };
  }
  return {
    text: JSON.stringify(
      { code: "InternalError", message: "unexpected internal failure" },
      null,
      2,
    ),
    isError: true,
  };
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
          await options.guard?.(entry.metadata, args as Record<string, unknown>);
          const result = await handler(args as Record<string, unknown>, {});
          return {
            content: result.content,
            ...(result.isError === true ? { isError: true as const } : {}),
          };
        } catch (error) {
          const failure = toErrorPayload(error);
          return {
            content: [{ type: "text" as const, text: failure.text }],
            isError: true as const,
          };
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
