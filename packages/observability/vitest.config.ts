import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/observability/src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "packages/observability/coverage",
      include: ["packages/observability/src/index.ts"],
      thresholds: {
        branches: 85,
      },
    },
  },
});
