import type { ProviderCapabilities } from "@alterx/contracts";

import { createMockProvider } from "../mock-provider";
import type {
  ArtifactDeploymentRequest,
  ArtifactDeploymentResult,
  DeploymentProvider,
  ProviderMetadata,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export interface MockDeploymentProvider extends DeploymentProvider {
  readonly requests: readonly ArtifactDeploymentRequest[];
}

export interface MockDeploymentProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"DeploymentProvider">;
  readonly capabilities?: ProviderCapabilities;
}

export function createMockDeploymentProvider(
  options: MockDeploymentProviderOptions = {},
): MockDeploymentProvider {
  const requests: ArtifactDeploymentRequest[] = [];
  return createMockProvider<MockDeploymentProvider>({
    metadata:
      options.metadata ??
      mockMetadata(options.providerId ?? "mock.deployment", "DeploymentProvider"),
    capabilities: options.capabilities ?? mockCapabilities(10_485_760),
    implementation: {
      requests,
      deployArtifact: async (request): Promise<ArtifactDeploymentResult> => {
        requests.push(request);
        return {
          deploymentReference: `mock://deployments/${request.projectId}/${request.artifactId}`,
        };
      },
    },
  });
}
