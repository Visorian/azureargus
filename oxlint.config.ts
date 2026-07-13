import e18e from "@e18e/eslint-plugin";
import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    ".data",
    ".nuxt",
    ".output",
    ".playwright-cli",
    "coverage",
    "node_modules",
    "playwright-report",
    "test-results",
  ],
  jsPlugins: ["@e18e/eslint-plugin"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  overrides: [
    {
      files: ["tests/**/*"],
      rules: {
        "e18e/prefer-array-from-map": "warn",
      },
    },
  ],
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "node", "promise", "vitest", "vue"],
  rules: {
    ...e18e.configs.recommended.rules,
    "e18e/prefer-static-regex": "warn",
  },
});
