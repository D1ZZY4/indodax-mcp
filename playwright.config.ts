import { defineConfig } from "@playwright/test";

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
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...process.env, MCP_PORT: "8000" },
    },
    {
      command: "bunx vite preview --port 5173 --strictPort --host 127.0.0.1",
      cwd: "apps/mcp-workbench",
      port: 5173,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
