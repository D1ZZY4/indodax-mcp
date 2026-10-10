import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/**
 * One client per page for the lifetime of the module.
 *
 * The MCP client keeps a session over Streamable HTTP, so reconnecting per call
 * would drop server-side session state and reopen a stream each time.
 */
let pending: Promise<Client> | null = null;

export function connectMcp(url: string): Promise<Client> {
  pending ??= (async () => {
    const client = new Client({ name: "mcp-workbench", version: "1.0.0" }, {});
    // Resolved against the page origin because the pages pass the relative
    // "/mcp". `new URL("/mcp")` throws in a browser, so every tool call failed
    // and the UI reported "Connection failed. Start mcp-http first" even when
    // the gateway was reachable.
    const target = new URL(url, window.location.origin);
    await client.connect(new StreamableHTTPClientTransport(target));
    return client;
  })();
  return pending;
}

/** Drop the cached client so the next call reconnects. */
export function resetMcp(): void {
  void pending?.then((client) => client.close());
  pending = null;
}

/**
 * The response envelope every tool returns.
 *
 * `ok` carries `data`; `fail` carries a stable `code` plus a message. Both are
 * JSON on the first text block, so a caller reads one shape and branches on
 * `status` instead of pattern-matching prose.
 */
export interface ToolEnvelope<T = unknown> {
  status: "ok" | "error";
  data?: T;
  warnings?: string[];
  code?: string;
  message?: string;
  retryable?: boolean;
}

/**
 * Call one tool and return its parsed envelope.
 *
 * Parsing lives here because every page needs it and each piece is easy to get
 * subtly wrong: the content blocks must be joined before parsing, and a
 * refusal still arrives as valid JSON rather than a thrown exception, so the
 * body is parsed even when the transport flags `isError`.
 */
export async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolEnvelope<T>> {
  const client = await connectMcp("/mcp");
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  return JSON.parse(text) as ToolEnvelope<T>;
}
