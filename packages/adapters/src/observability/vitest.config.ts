import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/adapters/src/observability/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "packages/adapters/src/observability/coverage",
      include: [
        "packages/adapters/src/observability/index.ts",
        "packages/adapters/src/observability/otel-provider.ts",
        "packages/adapters/src/observability/sentry-provider.ts",
      ],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
