import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vite.config";

// Text fitting needs real font measurement, so tests run in the installed Chrome.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({ launchOptions: { channel: "chrome" } }),
        instances: [{ browser: "chromium" }],
      },
    },
  }),
);
