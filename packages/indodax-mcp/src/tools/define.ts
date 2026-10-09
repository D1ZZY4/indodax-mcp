import { z } from "zod";
import type { ToolMetadata } from "@indodax-mcp/mcp-contracts";

/**
 * One declaration per tool.
 *
 * The MCP SDK validates incoming arguments against the registered
 * inputSchema and *strips* anything it does not declare. A handler that
 * re-declares its own wider schema therefore never sees the extra keys: the
 * call silently succeeds with the parameters dropped. Binding both the
 * registry entry and the handler parse to this single object makes that class
 * of drift impossible to express.
 */
export interface ToolDefinition<Shape extends z.ZodRawShape> {
  metadata: ToolMetadata;
  inputSchema: z.ZodObject<Shape>;
}

export function defineTool<Shape extends z.ZodRawShape>(
  metadata: ToolMetadata,
  shape: Shape,
): ToolDefinition<Shape> {
  return { metadata, inputSchema: z.object(shape) };
}

/**
 * Wrap a definition with a cross-field refinement, for example "cancel needs
 * orderId or clientOrderId". The refinement lives on the advertised schema so
 * clients discover the rule from the tool definition instead of hitting it as
 * a handler-level error.
 */
export function refineTool<Shape extends z.ZodRawShape>(
  definition: ToolDefinition<Shape>,
  check: (args: z.infer<z.ZodObject<Shape>>) => boolean,
  message: string,
): { metadata: ToolMetadata; inputSchema: z.ZodType<z.infer<z.ZodObject<Shape>>> } {
  return {
    metadata: definition.metadata,
    inputSchema: definition.inputSchema.refine(check, { message }),
  };
}
