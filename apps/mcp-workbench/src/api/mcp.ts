import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

let client: Client | null = null;

export async function connectMcp(url: string): Promise<Client> {
  if (client) return client;
  const next = new Client({ name: "mcp-workbench", version: "1.0.0" }, {});
  await next.connect(new StreamableHTTPClientTransport(new URL(url)));
  client = next;
  return next;
}

export function disconnectMcp(): void {
  void client?.close();
  client = null;
}
