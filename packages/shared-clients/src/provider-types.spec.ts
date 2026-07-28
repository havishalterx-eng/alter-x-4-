import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { AuditStoreProvider } from "./audit-ports";
import {
  CANONICAL_PROVIDER_INTERFACES,
  type BaseProvider,
  type BrowserProvider,
  type CacheProvider,
  type ComputeProvider,
  type ConfigProvider,
  type DeploymentProvider,
  type EmbeddingProvider,
  type EventBusProvider,
  type GPUComputeProvider,
  type IdentityProvider,
  type ModelProvider,
  type NetworkConnectivityProvider,
  type ObjectStorageProvider,
  type PIIRedactionProvider,
  type QueueProvider,
  type RelationalDatabaseProvider,
  type RepositoryProvider,
  type SandboxProvider,
  type SearchProvider,
  type VectorStoreProvider,
} from "./provider-types";

type MarkerProviders =
  | AuditStoreProvider
  | BrowserProvider
  | CacheProvider
  | ComputeProvider
  | ConfigProvider
  | DeploymentProvider
  | EmbeddingProvider
  | EventBusProvider
  | GPUComputeProvider
  | IdentityProvider
  | ModelProvider
  | NetworkConnectivityProvider
  | ObjectStorageProvider
  | PIIRedactionProvider
  | QueueProvider
  | RelationalDatabaseProvider
  | RepositoryProvider
  | SandboxProvider
  | SearchProvider
  | VectorStoreProvider;

describe("canonical provider interface surface", () => {
  it("locks all 23 CEO-reconciled interface names exactly once", () => {
    expect(CANONICAL_PROVIDER_INTERFACES).toEqual([
      "DurableExecutionProvider",
      "ComputeProvider",
      "IdentityProvider",
      "ModelProvider",
      "EmbeddingProvider",
      "PIIRedactionProvider",
      "SearchProvider",
      "BrowserProvider",
      "DeploymentProvider",
      "ObjectStorageProvider",
      "QueueProvider",
      "SecretsProvider",
      "BillingProvider",
      "ObservabilityProvider",
      "SandboxProvider",
      "RepositoryProvider",
      "ConfigProvider",
      "RelationalDatabaseProvider",
      "VectorStoreProvider",
      "CacheProvider",
      "EventBusProvider",
      "GPUComputeProvider",
      "NetworkConnectivityProvider",
      "AuditStoreProvider",
    ]);
    expect(new Set(CANONICAL_PROVIDER_INTERFACES)).toHaveLength(24);
    expectTypeOf<MarkerProviders>().toMatchTypeOf<BaseProvider>();
  });

  it("keeps the framework package free of vendor SDK dependencies", () => {
    const packageJson = JSON.parse(
      readFileSync("packages/shared-clients/package.json", "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    });
    const vendorSdkPatterns = [
      /^@aws-sdk\//,
      /^@temporalio\//,
      /^@auth0\//,
      /^@sentry\//,
      /^@opentelemetry\//,
      /^@google-cloud\//,
      /^@azure\//,
      /^openai$/,
      /^@anthropic-ai\//,
      /^razorpay$/,
      /^e2b$/,
      /^browserbase$/,
    ];

    expect(
      dependencyNames.filter((name) =>
        vendorSdkPatterns.some((pattern) => pattern.test(name)),
      ),
    ).toEqual([]);
  });
});
