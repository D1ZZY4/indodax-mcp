import { defineConfig, mergeConfig } from "vitest/config";
// The extension is required because Vite is moving to a native config loader
// that does not resolve extensionless relative imports.
import viteConfig from "./vite.config.ts";

/**
 * Merges the application Vite config so the render environment and the browser
 * tests resolve modules through exactly the same aliases. Keeping one source
 * of truth avoids the two configs drifting apart.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
    },
  }),
);
