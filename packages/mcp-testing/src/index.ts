import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";

export interface Harness {
  client: Client;
  close: () => Promise<void>;
}

async function newClient(): Promise<Client> {
  return new Client({ name: "mcp-test-harness", version: "1.0.0" }, {});
}

export async function withInMemoryServer(server: McpServer): Promise<Harness> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = await newClient();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export async function withStdioCommand(command: string, args: string[] = []): Promise<Harness> {
  const transport = new StdioClientTransport({ command, args });
  const client = await newClient();
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

export async function withHttpUrl(url: string): Promise<Harness> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = await newClient();
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}
