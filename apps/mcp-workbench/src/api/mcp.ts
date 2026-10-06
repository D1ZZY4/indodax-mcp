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
