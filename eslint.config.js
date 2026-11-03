import eslint from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import svelteConfig from "./svelte.config.js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  svelte.configs.recommended,
  [
    {
      languageOptions: {
        globals: {
          ...globals.browser,
          ...globals.node,
        },
      },
    },
    {
      files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],

      languageOptions: {
        parserOptions: {
          projectService: true,
          extraFileExtensions: [".svelte"], // Add support for additional file extensions, such as .svelte
          parser: tseslint.parser,
          svelteConfig,
        },
      },
    },
    {
      // Built app files (www/, Android/iOS projects) and test output are not source.
      ignores: ["dist/", "standalone-apps/", ".vitest-attachments/", "**/__screenshots__/"],
    },
    {
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ]
);
