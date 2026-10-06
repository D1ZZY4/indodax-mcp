import { defineConfig } from "@playwright/test";

/**
 * CI always starts its own servers so the suite proves the current build.
 *
 * Locally a developer or harness often already runs the gateway, and an
 * unconditional `reuseExistingServer: false` made the whole E2E suite fail on
 * "port 8000 is already used" rather than on anything about the application.
 * Reusing an existing server off CI keeps the suite runnable without weakening
 * what CI verifies.
 */
const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
  },
  webServer: [
    {
      command: "bun apps/mcp-http/src/main.ts",
      port: 8000,
      reuseExistingServer,
      timeout: 30_000,
      env: { ...process.env, MCP_PORT: "8000" },
    },
    {
      command: "bunx vite preview --port 5173 --strictPort --host 127.0.0.1",
      cwd: "apps/mcp-workbench",
      port: 5173,
      reuseExistingServer,
      timeout: 60_000,
    },
  ],
});
