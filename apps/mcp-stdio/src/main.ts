import { loadConfig } from "@d1zzy4-jethools/config";
import { serveStdioTransport } from "@d1zzy4-jethools/mcp-runtime";
import { createLogger } from "@d1zzy4-jethools/logging";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";

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
