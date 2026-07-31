import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/cost-ledger-service/src/**/*.spec.ts"],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "apps/cost-ledger-service/coverage",
      include: [
        "apps/cost-ledger-service/src/config/**/*.ts",
        "apps/cost-ledger-service/src/database/**/*.ts",
        "apps/cost-ledger-service/src/estimation/**/*.ts",
        "apps/cost-ledger-service/src/health/**/*.ts",
        "apps/cost-ledger-service/src/ingest/**/*.ts",
      ],
      exclude: ["apps/cost-ledger-service/src/**/*.spec.ts"],
    },
  },
});
