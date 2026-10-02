import { loadEnv } from "@indodax-mcp/config";
import { serveStdioTransport } from "@indodax-mcp/mcp-runtime";
import { createLogger } from "@indodax-mcp/logging";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

const env = loadEnv();
const logger = createLogger({ service: "mcp-stdio" });
const { server: mcpServer, registry } = buildIndodaxServer(env);

await serveStdioTransport(() => mcpServer);
logger.info(`serving indodax-mcp over stdio with ${registry.listTools().length} tools`);
