import { loadConfig } from "@indodax-mcp/config";
import { createLogger } from "@indodax-mcp/logging";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { buildHttpApp } from "@indodax-mcp/mcp-runtime";

// loadConfig keeps the parsed environment and its provenance together, so
// indodax_config_status can explain which channel supplied each credential.
const { env, diagnostic } = loadConfig();
const logger = createLogger({ service: "mcp-http" });
const { registry, app: services, createServer } = buildIndodaxServer(env, diagnostic);
const port = env.MCP_PORT ?? 8000;

// Each Streamable HTTP request needs a fresh MCP server instance sharing
// the same application services. Reusing one instance fails the SDK guard
// with "still serving another request".
const app = buildHttpApp(() => createServer());

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
  void (async () => {
    for (const hook of services.shutdownHooks) {
      try {
        await hook();
      } catch (error) {
        logger.warn({ error: String(error) }, "http shutdown hook failed");
      }
    }
    server.stop(true);
    process.exit(0);
  })();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
