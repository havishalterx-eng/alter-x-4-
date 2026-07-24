import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/platform-api/src/**/*.spec.ts",
      "tests/integration/rbac/**/*.spec.ts",
    ],
    exclude: [
      "apps/platform-api/src/db/db.migration.spec.ts",
      "apps/platform-api/src/identity/**/*.integration.spec.ts",
      "apps/platform-api/src/signup/**/*.integration.spec.ts",
    ],
    coverage: {
      provider: "v8",
      all: true,
      include: [
        "apps/platform-api/src/db/**/*.ts",
        "apps/platform-api/src/identity/**/*.ts",
        "apps/platform-api/src/rbac/**/*.ts",
        "apps/platform-api/src/identity-broker/**/*.ts",
        "apps/platform-api/src/entitlements/**/*.ts",
        "apps/platform-api/src/abuse/**/*.ts",
        "apps/platform-api/src/signup/**/*.ts",
        "apps/platform-api/src/tenants/**/*.ts",
        "apps/platform-api/src/workspaces/**/*.ts",
        "apps/platform-api/src/members/**/*.ts",
      ],
      exclude: [
        "apps/platform-api/src/db/**/*.spec.ts",
        "apps/platform-api/src/identity/**/*.spec.ts",
        "apps/platform-api/src/rbac/**/*.spec.ts",
        "apps/platform-api/src/identity-broker/**/*.spec.ts",
        "apps/platform-api/src/entitlements/**/*.spec.ts",
        "apps/platform-api/src/abuse/**/*.spec.ts",
        "apps/platform-api/src/signup/**/*.spec.ts",
        "apps/platform-api/src/tenants/**/*.spec.ts",
        "apps/platform-api/src/workspaces/**/*.spec.ts",
        "apps/platform-api/src/members/**/*.spec.ts",
      ],
      thresholds: {
        lines: 90,
        "apps/platform-api/src/identity/**/*.ts": {
          lines: 90,
          branches: 90,
        },
        "apps/platform-api/src/rbac/**/*.ts": {
          lines: 90,
          branches: 90,
        },
        "apps/platform-api/src/identity-broker/**/*.ts": {
          lines: 90,
          branches: 90,
        },
        "apps/platform-api/src/{entitlements,abuse}/**/*.ts": {
          lines: 85,
          branches: 85,
        },
        "apps/platform-api/src/signup/**/*.ts": {
          lines: 85,
          branches: 85,
        },
        "apps/platform-api/src/tenants/**/*.ts": {
          lines: 85,
          branches: 85,
        },
        "apps/platform-api/src/workspaces/**/*.ts": {
          lines: 85,
          branches: 85,
        },
        "apps/platform-api/src/members/**/*.ts": {
          lines: 85,
          branches: 85,
        },
      },
    },
  },
});
