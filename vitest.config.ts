import { fileURLToPath } from "node:url";

import { playwright } from "@vitest/browser-playwright";
import { defineVitestProject } from "@nuxt/test-utils/config";
import { defineConfig } from "vitest/config";

const alias = {
  "#shared": fileURLToPath(new URL("./shared", import.meta.url)),
  "~": fileURLToPath(new URL("./app", import.meta.url)),
};
const browserExecutablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browserProjects = browserExecutablePath
  ? [
      {
        resolve: {
          alias,
        },
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" as const }],
            provider: playwright({
              launchOptions: { executablePath: browserExecutablePath },
            }),
          },
          globals: true,
          include: ["tests/browser/**/*.test.ts"],
          name: "browser",
        },
      },
    ]
  : [];

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    projects: [
      {
        resolve: {
          alias,
        },
        test: {
          environment: "node",
          globals: true,
          include: ["tests/unit/**/*.test.ts"],
          name: "unit",
        },
      },
      await defineVitestProject({
        test: {
          environment: "nuxt",
          environmentOptions: {
            nuxt: {
              domEnvironment: "happy-dom",
              rootDir: fileURLToPath(new URL(".", import.meta.url)),
            },
          },
          globals: true,
          include: ["tests/nuxt/**/*.test.ts"],
          name: "nuxt",
        },
      }),
      ...browserProjects,
    ],
  },
});
