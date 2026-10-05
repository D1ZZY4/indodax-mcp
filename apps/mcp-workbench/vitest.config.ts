import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

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
