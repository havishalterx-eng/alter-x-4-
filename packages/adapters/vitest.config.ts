import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/adapters/src/**/*.spec.ts"],
    hookTimeout: 120_000,
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "packages/adapters/coverage",
      include: [
        "packages/adapters/src/temporal/durable-execution-provider.ts",
      ],
      thresholds: {
        branches: 85,
      },
    },
  },
});
