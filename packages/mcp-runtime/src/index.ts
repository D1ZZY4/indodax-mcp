import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import type { Hono } from "hono";
import type { Server } from "bun";

export async function serveStdioTransport(build: () => McpServer): Promise<void> {
  await serveStdio(build);
}

export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export interface HttpServeOptions {
  port: number;
  hostname?: string;
  path?: string;
}

export function buildHttpApp(build: () => McpServer, path = "/mcp"): Hono {
  const handler = createMcpHandler(build);
  const app = createMcpHonoApp();
  app.all(path, (c) => handler.fetch(c.req.raw));
  return app;
}

export function serveHttp(build: () => McpServer, options: HttpServeOptions): Server<unknown> {
  const runtime = (globalThis as { Bun?: typeof import("bun") }).Bun;
  if (!runtime) {
    throw new Error("serveHttp requires the Bun runtime");
  }
  const app = buildHttpApp(build, options.path);
  const port = options.port;
  const hostname = options.hostname ?? "127.0.0.1";
  return runtime.serve({ port, hostname, fetch: app.fetch });
}
