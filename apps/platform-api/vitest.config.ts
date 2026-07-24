import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/platform-api/src/**/*.spec.ts"],
    exclude: ["apps/platform-api/src/db/db.migration.spec.ts"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["apps/platform-api/src/db/**/*.ts"],
      exclude: ["apps/platform-api/src/db/**/*.spec.ts"],
      thresholds: {
        lines: 90,
      },
    },
  },
});
