import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Application source is imported through the package name, so Vite needs the
 * same mapping the TypeScript `paths` entry provides. Without this alias Vite
 * cannot resolve `@indodax-mcp/mcp-workbench/*` and the dev server and browser
 * tests both fail to load a page module.
 */
const srcRoot = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@indodax-mcp/mcp-workbench": srcRoot,
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/mcp": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "dist",
  },
});
