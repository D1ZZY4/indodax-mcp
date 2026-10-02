import { loadEnv } from "@indodax-mcp/config";
import { createLogger } from "@indodax-mcp/logging";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { buildHttpApp } from "@indodax-mcp/mcp-runtime";

const env = loadEnv();
const logger = createLogger({ service: "mcp-http" });
const { server: mcpServer, registry } = buildIndodaxServer(env);
const port = env.MCP_PORT ?? 8000;

const app = buildHttpApp(() => mcpServer);

app.get("/health", (c) =>
  c.json({ status: "ok", server: "indodax-mcp", version: "1.0.0", mode: env.APP_ENV }),
);

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
});

logger.info(`mcp http listening on ${port} with ${registry.listTools().length} tools`);

function shutdown(): void {
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
