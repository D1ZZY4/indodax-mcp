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
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    return client;
  })();
  return pending;
}

/** Drop the cached client so the next call reconnects. */
export function resetMcp(): void {
  void pending?.then((client) => client.close());
  pending = null;
}
