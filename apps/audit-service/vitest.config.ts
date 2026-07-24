import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/audit-service/src/**/*.spec.ts"],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "apps/audit-service/coverage",
      include: [
        "apps/audit-service/src/audit/**/*.ts",
        "apps/audit-service/src/config/**/*.ts",
        "apps/audit-service/src/database/**/*.ts",
        "apps/audit-service/src/health/**/*.ts"
      ],
      exclude: ["apps/audit-service/src/**/*.spec.ts"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90
      }
    }
  }
});
