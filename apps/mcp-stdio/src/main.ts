import { loadConfig } from "@indodax-mcp/config";
import { serveStdioTransport } from "@indodax-mcp/mcp-runtime";
import { createLogger } from "@indodax-mcp/logging";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

const { env, diagnostic } = loadConfig();
const logger = createLogger({ service: "mcp-stdio" });
const { server: mcpServer, registry, app } = buildIndodaxServer(env, diagnostic);

async function shutdown(): Promise<void> {
  for (const hook of app.shutdownHooks) {
    try {
      await hook();
    } catch (error) {
      logger.warn({ error: String(error) }, "stdio shutdown hook failed");
    }
  }
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

try {
  logger.info(`serving indodax-mcp over stdio with ${registry.listTools().length} tools`);
  await serveStdioTransport(() => mcpServer);
} finally {
  await shutdown();
}
