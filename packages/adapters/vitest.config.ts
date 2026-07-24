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
        "packages/adapters/src/aws/secrets-manager-provider.ts",
        "packages/adapters/src/grpc/audit-grpc-transport.ts",
        "packages/adapters/src/postgres/audit-store-provider.ts",
        "packages/adapters/src/postgres/orchestration-store-provider.ts",
        "packages/adapters/src/temporal/durable-execution-provider.ts",
      ],
      thresholds: {
        branches: 90,
        lines: 90,
      },
    },
  },
});
