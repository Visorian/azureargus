import { fileURLToPath } from "node:url";

import { defineVitestProject } from "@nuxt/test-utils/config";
import { defineConfig } from "vitest/config";

const alias = {
  "#shared": fileURLToPath(new URL("./shared", import.meta.url)),
  "~": fileURLToPath(new URL("./app", import.meta.url)),
};

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
    ],
  },
});
