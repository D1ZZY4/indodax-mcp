import { serveStdioTransport } from "@indodax-mcp/mcp-runtime";
import { createLogger } from "@indodax-mcp/logging";
import { buildAppServer } from "./app.js";

const logger = createLogger({ service: "mcp-stdio" });

await serveStdioTransport(buildAppServer);
logger.info("serving indodax-mcp over stdio");
