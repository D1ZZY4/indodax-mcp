import type { z } from "zod";
import {
  type PromptMetadata,
  promptMetadataSchema,
  type ResourceMetadata,
  resourceMetadataSchema,
  type ToolMetadata,
  toolMetadataSchema,
} from "@indodax-mcp/mcp-contracts";

export interface ToolEntry {
  metadata: ToolMetadata;
  inputSchema: z.ZodType<unknown>;
  outputSchema?: z.ZodType<unknown> | undefined;
}

export interface ResourceEntry {
  metadata: ResourceMetadata;
}

export interface PromptEntry {
  metadata: PromptMetadata;
}

export class Registry {
  private readonly tools = new Map<string, ToolEntry>();
  private readonly resources = new Map<string, ResourceEntry>();
  private readonly prompts = new Map<string, PromptEntry>();

  registerTool(entry: {
    metadata: ToolMetadata;
    inputSchema: z.ZodType<unknown>;
    outputSchema?: z.ZodType<unknown> | undefined;
  }): void {
    const metadata = toolMetadataSchema.parse(entry.metadata);
    if (this.tools.has(metadata.name)) {
      throw new Error(`duplicate tool: ${metadata.name}`);
    }
    this.tools.set(metadata.name, { ...entry, metadata });
  }

  registerResource(metadata: ResourceMetadata): void {
    const parsed = resourceMetadataSchema.parse(metadata);
    if (this.resources.has(parsed.uri)) throw new Error(`duplicate resource: ${parsed.uri}`);
    this.resources.set(parsed.uri, { metadata: parsed });
  }

  registerPrompt(metadata: PromptMetadata): void {
    const parsed = promptMetadataSchema.parse(metadata);
    if (this.prompts.has(parsed.name)) throw new Error(`duplicate prompt: ${parsed.name}`);
    this.prompts.set(parsed.name, { metadata: parsed });
  }

  getTool(name: string): ToolEntry | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolEntry[] {
    return [...this.tools.values()];
  }

  listResources(): ResourceEntry[] {
    return [...this.resources.values()];
  }

  listPrompts(): PromptEntry[] {
    return [...this.prompts.values()];
  }
}
